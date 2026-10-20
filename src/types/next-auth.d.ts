import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: "admin" | "user";
      autoApprove: boolean;
    };
  }

  interface User {
    /** Copied into the JWT at sign-in; see the jwt callback in lib/auth/config.ts. */
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    sessionVersion?: number;
  }
}
