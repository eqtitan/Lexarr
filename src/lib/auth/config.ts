import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import { authenticateJellyfin } from "@/lib/auth/jellyfin";
import { getPlexUser, isPlexEnabled } from "@/lib/auth/plex";
import bcrypt from "bcryptjs";

// Constant hash to compare against when no user/password row exists, so the
// "no such user" path takes roughly the same time as a real wrong-password
// check instead of short-circuiting — closes a username-enumeration timing
// oracle. The plaintext behind this hash is never used for anything else.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  "lexarr-dummy-password-for-constant-time-compare",
  10,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // Plex SSO — receives a Plex auth token from the pin flow
    CredentialsProvider({
      id: "plex",
      name: "Plex",
      credentials: {
        plexToken: { label: "Plex Token", type: "text" },
      },
      async authorize(credentials) {
        if (!isPlexEnabled() || !credentials?.plexToken) return null;
        try {
          const plexUser = await getPlexUser(credentials.plexToken as string);
          // First real user becomes admin. count() + upsert() run inside one
          // transaction so two concurrent first-logins can't both observe
          // count === 0 and both get granted admin — see request.ts's
          // $transaction comment for why this is serializable on SQLite.
          const user = await prisma.$transaction(async (tx) => {
            const userCount = await tx.user.count({
              where: { id: { not: "system" } },
            });
            return tx.user.upsert({
              where: { plexId: plexUser.plexId },
              update: {
                name: plexUser.name,
                email: plexUser.email,
                avatar: plexUser.avatar,
              },
              create: {
                plexId: plexUser.plexId,
                name: plexUser.name,
                email: plexUser.email,
                avatar: plexUser.avatar,
                role: userCount === 0 ? "admin" : "user",
                autoApprove: userCount === 0,
              },
            });
          });
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.avatar,
            sessionVersion: user.sessionVersion,
          };
        } catch {
          return null;
        }
      },
    }),
    CredentialsProvider({
      id: "credentials",
      name: "Lexarr Account",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;
        // P-01: User.name is now @unique, so use findUnique for a deterministic
        // lookup. Credential input can be either username or email — try name
        // first, then email. Can't OR with findUnique, so two queries.
        const username = credentials.username as string;
        const user =
          (await prisma.user.findUnique({ where: { name: username } })) ??
          (await prisma.user.findUnique({ where: { email: username } }));
        // Always run a bcrypt compare, even for a nonexistent/OAuth-only
        // user, against a fixed dummy hash — otherwise this path returns
        // near-instantly while a real wrong-password check takes a bcrypt
        // round, letting a timing difference confirm whether a username
        // exists at all.
        const valid = await bcrypt.compare(
          credentials.password as string,
          user?.password ?? DUMMY_PASSWORD_HASH,
        );
        if (!user?.password || !valid) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.avatar,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
    CredentialsProvider({
      id: "jellyfin",
      name: "Jellyfin",
      credentials: {
        username: { label: "Jellyfin Username", type: "text" },
        password: { label: "Jellyfin Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;
        const jfUser = await authenticateJellyfin(
          credentials.username as string,
          credentials.password as string,
        );
        if (!jfUser) return null;

        // See the Plex provider above — count() + upsert() must be atomic.
        const user = await prisma.$transaction(async (tx) => {
          const userCount = await tx.user.count({
            where: { id: { not: "system" } },
          });
          return tx.user.upsert({
            where: { jellyfinId: jfUser.jellyfinId },
            update: { name: jfUser.name, avatar: jfUser.avatar },
            create: {
              jellyfinId: jfUser.jellyfinId,
              name: jfUser.name,
              avatar: jfUser.avatar,
              role: userCount === 0 ? "admin" : "user",
              autoApprove: userCount === 0,
            },
          });
        });
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.avatar,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // Runs on every session read (JWT strategy). Returning null clears the
    // session cookie, i.e. signs the user out -- used to revoke sessions:
    // the user was deleted, or their sessionVersion was bumped (password
    // reset, role change) after this token was issued. Tokens from before
    // sessionVersion existed carry none and count as 0, matching the
    // column's default, so that rollout logged nobody out.
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.sessionVersion = user.sessionVersion ?? 0;
        return token;
      }
      if (token.userId) {
        const current = await prisma.user.findUnique({
          where: { id: token.userId as string },
          select: { sessionVersion: true },
        });
        if (!current || current.sessionVersion !== (token.sessionVersion ?? 0)) {
          return null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.userId as string },
        });
        if (dbUser) {
          session.user.id = dbUser.id;
          session.user.role = dbUser.role as "admin" | "user";
          session.user.autoApprove = dbUser.autoApprove;
        }
      }
      return session;
    },
  },
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
});
