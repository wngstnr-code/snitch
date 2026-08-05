import { VerificationDetail } from '@/components/verification-detail';

export default async function VerificationPage(
  props: PageProps<'/verifications/[id]'>,
) {
  const { id } = await props.params;
  return <VerificationDetail id={id} />;
}
