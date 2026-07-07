import { createAuth } from "../auth";

// Static instance for Better Auth schema generation (`npx auth generate`).
export const auth = createAuth({} as never);
