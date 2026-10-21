import AiBubbleMonitor from '@/components/AiBubbleMonitor'
import type { LatestData, HistoryData } from '@/components/AiBubbleMonitor'
import type { ModelData } from '@/components/ModelView'
import type { CapexData, CommitmentsData } from '@/components/ForwardPurchases'
import type { BriefingData } from '@/components/Briefing'
import latestData from '@/data/ai-bubble/latest.json'
import historyData from '@/data/ai-bubble/history.json'
import modelData from '@/data/ai-bubble/model.json'
import capexData from '@/data/ai-bubble/sec-capex.json'
import commitmentsData from '@/data/ai-bubble/commitments.json'
import briefingData from '@/data/ai-bubble/briefing.json'

export default function Home() {
  return (
    <AiBubbleMonitor
      latest={latestData as LatestData}
      history={historyData as HistoryData}
      model={modelData as unknown as ModelData}
      capex={capexData as unknown as CapexData}
      commitments={commitmentsData as unknown as CommitmentsData}
      briefing={briefingData as unknown as BriefingData}
    />
  )
}
