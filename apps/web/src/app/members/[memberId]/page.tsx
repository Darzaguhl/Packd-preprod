import MemberProfilePage from '@/components/member/MemberProfilePage'

export default async function Page({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params
  return <MemberProfilePage memberId={memberId} />
}
