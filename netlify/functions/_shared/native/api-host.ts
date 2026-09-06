import { createNativeApiDeployment } from './deployment.ts'
import type { NativeDeploymentOptions } from './deployment.ts'
import { createNativeRuntimeDependencies, type NativeRuntimePorts } from './runtime-dependencies.ts'

export type NativeApiHostPorts = NativeRuntimePorts & Pick<NativeDeploymentOptions, 'loadPool'>

/** Internal composition only. A separately authorized platform entry supplies trusted request options. */
export function createNativeApiHost(ports: NativeApiHostPorts) {
  return createNativeApiDeployment({
    get mode() { return ports.mode },
    loadBackendOptions: () => {
      const assembly = createNativeRuntimeDependencies(ports)
      if (!assembly) throw new Error('原生模式未启用')
      return { providerOptions: assembly.providerOptions, closureOptions: assembly.closureOptions }
    },
    loadPool: () => ports.loadPool(),
  })
}
