import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { WebhookEvent } from '@clerk/nextjs/server';
import { sql } from '@/lib/db';

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

    // If user has external_id (imported from Supabase), use that UUID.
    // Otherwise generate a new one for brand-new users.
    const dbUserId = external_id || crypto.randomUUID();

    try {
      await sql`
        INSERT INTO user_id_mapping (clerk_user_id, db_user_id, email)
        VALUES (${id}, ${dbUserId}::uuid, ${email})
        ON CONFLICT (clerk_user_id) DO NOTHING
      `;
      console.log(`[webhook] Mapped ${email} -> ${dbUserId}`);
    } catch (err) {
      console.error(`[webhook] Failed to insert user mapping:`, err);
      return new Response('Failed to create user mapping', { status: 500 });
    }
  }

  return new Response('OK', { status: 200 });
}
