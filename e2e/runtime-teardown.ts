/** Stop only this loopback synthetic fixture; its close routine verifies its random schema was removed. */
export default async function runtimeTeardown() {
  const stopWeb = async () => { await fetch('http://127.0.0.1:5175/__shutdown', {
    method:'POST', headers:{'X-ARC-Synthetic-Control':'TEST_ONLY'}, signal:AbortSignal.timeout(3000),
  }).catch(() => {}) }
  try {
    const ready = await fetch('http://127.0.0.1:48275/__ready', { signal: AbortSignal.timeout(3000) })
    if (!(await ready.json()).synthetic) throw new Error('Unexpected runtime fixture identity')
    const response = await fetch('http://127.0.0.1:48275/__shutdown', {
      method: 'POST', headers: { 'X-ARC-Synthetic-Control': 'TEST_ONLY' }, signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error('Runtime cleanup not acknowledged')
    if (await response.text() !== 'runtime schema removed and verified') throw new Error('Runtime schema removal was not verified')
    for (let attempt = 0; attempt < 50; attempt++) {
      try { await fetch('http://127.0.0.1:48275/__ready', { signal: AbortSignal.timeout(1000) }) }
      catch { await stopWeb(); return }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Runtime fixture did not stop')
  } catch (error) {
    if (error instanceof TypeError && error.message === 'fetch failed') { await stopWeb(); return }
    throw error
  }
}
