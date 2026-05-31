const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// Watch the whole monorepo so workspace packages resolve
config.watchFolders = [monorepoRoot]

// Resolution order: app-local first, then root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]

// Force every require('react') and require('react-native') — no matter
// which package triggers it — to the single copy in the app's node_modules.
// This prevents the "multiple copies of React" crash in a monorepo.
const reactModulePath      = require.resolve('react',        { paths: [projectRoot] })
const reactNativeModulePath = require.resolve('react-native', { paths: [projectRoot] })
const reactDomModulePath   = require.resolve('react-dom',    { paths: [projectRoot] })

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react')        return { filePath: reactModulePath,       type: 'sourceFile' }
  if (moduleName === 'react-native') return { filePath: reactNativeModulePath, type: 'sourceFile' }
  if (moduleName === 'react-dom')    return { filePath: reactDomModulePath,    type: 'sourceFile' }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
