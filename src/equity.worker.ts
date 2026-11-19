import { calculateEquity, type EquityInput, type EquityResult } from './equity.ts'

export type WorkerResponse =
  | { type: 'result'; result: EquityResult }
  | { type: 'progress'; progress: number }
  | { type: 'error'; message: string }

self.onmessage = (event: MessageEvent<EquityInput>) => {
  const send = (message: WorkerResponse) => self.postMessage(message)
  try {
    const result = calculateEquity(event.data, progress => send({ type: 'progress', progress }))
    send({ type: 'result', result })
  } catch (error) {
    send({ type: 'error', message: (error as Error).message })
  }
}
