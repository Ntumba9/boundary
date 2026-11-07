import { authed, json } from '@/lib/api';

export const GET = authed(async ({ auth }) =>
  json({
    userId: auth.userId,
    email: auth.email,
    role: auth.role,
    companyId: auth.companyId,
    companyName: auth.companyName,
  }),
);
