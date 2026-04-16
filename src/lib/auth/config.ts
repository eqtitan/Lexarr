import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import { authenticateJellyfin } from "@/lib/auth/jellyfin";
import { getPlexUser } from "@/lib/auth/plex";
import bcrypt from "bcryptjs";

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
        if (!credentials?.plexToken) return null;
        try {
          const plexUser = await getPlexUser(credentials.plexToken as string);
          // First real user becomes admin
          const userCount = await prisma.user.count({
            where: { id: { not: "system" } },
          });
          const user = await prisma.user.upsert({
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
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.avatar,
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
        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { name: credentials.username as string },
              { email: credentials.username as string },
            ],
          },
        });
        if (!user?.password) return null;
        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password,
        );
        if (!valid) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.avatar,
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

        const userCount = await prisma.user.count({
          where: { id: { not: "system" } },
        });
        const user = await prisma.user.upsert({
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
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.avatar,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
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
