import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { WebhookEvent, clerkClient } from '@clerk/nextjs/server';

// Known Episodic users from Supabase - map email to UUID
const KNOWN_USERS: Record<string, string> = {
  'p6doyle@gmail.com': '548f3665-61f7-4411-89e1-cc724903cfa1',
  'peyton.doyle@icloud.com': '548f3665-61f7-4411-89e1-cc724903cfa1',
  'kaley.werder@gmail.com': '3ba378d6-20ce-4c50-9aee-e20ac498a99e',
};

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error('CLERK_WEBHOOK_SECRET is not set');
  }

  const headerPayload = await headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Missing svix headers', { status: 400 });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);

  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: WebhookEvent;

  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return new Response('Webhook verification failed', { status: 400 });
  }

  const eventType = evt.type;

  if (eventType === 'user.created') {
    const { id, email_addresses, external_id } = evt.data;
    const email = email_addresses?.[0]?.email_address?.toLowerCase() || null;

    console.log(`[webhook] New user created: ${email} (Clerk ID: ${id})`);

    // If user already has externalId, we're done (imported user)
    if (external_id) {
      console.log(`[webhook] User already has externalId: ${external_id}`);
      return new Response('OK', { status: 200 });
    }

    // Check if this email matches a known Episodic user
    if (email && KNOWN_USERS[email]) {
      const supabaseId = KNOWN_USERS[email];
      console.log(`[webhook] Linking ${email} to Supabase UUID: ${supabaseId}`);

      try {
        const client = await clerkClient();
        await client.users.updateUser(id, {
          externalId: supabaseId,
        });
        console.log(`[webhook] Successfully set externalId for ${email}`);
      } catch (err) {
        console.error(`[webhook] Failed to set externalId:`, err);
      }
    } else {
      console.log(`[webhook] Unknown user email: ${email} - no externalId set`);
    }
  }

  return new Response('OK', { status: 200 });
}
