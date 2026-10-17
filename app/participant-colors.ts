const SELF = { dot: "#60a5fa", background: "#fef08a", border: "#fcd34d", text: "#713f12" };
const OTHERS = [
  { dot: "#e993a8", background: "#fff0f3", border: "#f3c5cf", text: "#97455d" },
  { dot: "#b59add", background: "#f5effc", border: "#ddcef0", text: "#76539b" },
];

// 表示順・読書モード・作品の違いに左右されず、同じ参加者には同じ色を使う。
// 自分は従来色を保ち、他の2人をグループ内のUID順で区別する。
export function participantColors(memberIds: string[], selfId: string, id: string) {
  if (id === selfId) return SELF;
  const others = Array.from(new Set(memberIds)).filter(member => member !== selfId).sort();
  const index = others.indexOf(id);
  return OTHERS[Math.max(0, index) % OTHERS.length];
}
