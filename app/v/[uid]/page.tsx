import type { Metadata } from 'next';
import { PublicVerify } from '@/components/public-verify';

export const metadata: Metadata = { title: 'Verify attestation' };

export default async function PublicVerifyPage(props: PageProps<'/v/[uid]'>) {
  const { uid } = await props.params;
  return <PublicVerify uid={uid} />;
}
