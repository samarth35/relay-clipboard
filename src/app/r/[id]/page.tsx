import Room from "@/components/room";
export const metadata = { title: "Your room — Relay" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Room key={id} id={id} />;
}
