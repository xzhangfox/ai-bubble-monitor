import AiBubbleMonitor from '@/components/AiBubbleMonitor'
import type { LatestData, HistoryData } from '@/components/AiBubbleMonitor'
import latestData from '@/data/ai-bubble/latest.json'
import historyData from '@/data/ai-bubble/history.json'

export default function Home() {
  return <AiBubbleMonitor latest={latestData as LatestData} history={historyData as HistoryData} />
}
