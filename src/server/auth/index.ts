import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { getBaseUrl, getValidInvite } from "./invites";

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }

  return betterAuth({
    appName: "Ailoom",
    baseURL: process.env.BETTER_AUTH_URL?.trim() || getBaseUrl(),
    secret,
    database: drizzleAdapter(getDb(), { provider: "sqlite", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: true,
          defaultValue: "user",
          input: false
        }
      },
      validateUserInfo: ({ user, source }, context) => {
        if (source.action !== "create-user") return;
        if (source.method !== "email-password") return { error: "invite_required" };
        if (typeof user.email !== "string") return { error: "invite_required" };
        if (!getValidInvite(context.body?.inviteToken, user.email)) {
          return { error: "invite_required" };
        }
      }
    },
    databaseHooks: {
      user: {
        create: {
          before: async (data, context) => {
            const matchingInvite = getValidInvite(context?.body?.inviteToken, data.email);
            if (!matchingInvite) return false;
            return { data: { role: matchingInvite.role } };
          }
        }
      }
    }
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function getAuth(): ReturnType<typeof createAuth> {
  instance ??= createAuth();
  return instance;
}
