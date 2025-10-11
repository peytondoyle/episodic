'use client';

import { useParams } from 'next/navigation';

export default function ShowPage() {
  const params = useParams();
  const slug = params.slug as string;

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold">Show: {slug}</h1>
      <p className="text-gray-500">Show details coming soon...</p>
    </div>
  );
}
