import { join } from 'path'
import { writeFileSync } from 'fs'

import { GatsbyNode, PluginOptions as GatsbyPluginOptions } from 'gatsby'
import WebpackAssetsManifest from 'webpack-assets-manifest'

import { BUILD_HTML_STAGE, VTEX_NGINX_CONF_FILENAME } from './constants'
import {
  addPublicCachingHeader,
  addStaticCachingHeader,
  applyUserHeadersTransform,
  emptyHeadersMapForFiles,
  cacheHeadersByPath,
  preloadHeadersByPath,
} from './headers'
import { generateNginxConfiguration } from './nginx-generator'
import { listFilesRecursively } from './listFiles'

const assetsManifest: Record<string, string> = {}

interface PluginOptions extends GatsbyPluginOptions {
  transformHeaders?: (headers: string[], path: string) => string[]
}

const Node: GatsbyNode = {
  onCreateWebpackConfig({ actions, stage }) {
    if (stage !== BUILD_HTML_STAGE) {
      return
    }

    actions.setWebpackConfig({
      plugins: [
        new WebpackAssetsManifest({
          assets: assetsManifest,
          merge: true,
        }),
      ],
    })
  },

  async onPostBuild(
    { store, pathPrefix, reporter },
    { transformHeaders }: PluginOptions
  ) {
    const { program, pages: pagesMap, redirects } = store.getState() as {
      pages: Map<string, Page>
      program: { directory: string }
      redirects: Redirect[]
    }

    const pages = Array.from(pagesMap.values())

    const rewrites: Redirect[] = pages
      .filter((page) => page.matchPath && page.matchPath !== page.path)
      .map((page) => ({
        fromPath: page.matchPath as string,
        toPath: page.path,
      }))

    const publicFolder = join(program.directory, 'public')

    const { assetsByChunkName } = require(join(
      publicFolder,
      'webpack.stats.json'
    ))

    const manifest = {
      ...mapObjectValues(assetsManifest, (value) => [value]),
      ...assetsByChunkName,
    }

    const files = await listFilesRecursively(publicFolder)

    let headers = {
      ...emptyHeadersMapForFiles(files),
      ...preloadHeadersByPath(pages, manifest, pathPrefix),
      ...cacheHeadersByPath(pages, manifest),
    }

    if (typeof transformHeaders === 'function') {
      headers = applyUserHeadersTransform(headers, transformHeaders)
    }

    headers = addStaticCachingHeader(headers)

    headers = addPublicCachingHeader(headers)

    writeFileSync(
      join(program.directory, 'public', VTEX_NGINX_CONF_FILENAME),
      generateNginxConfiguration(rewrites, redirects, headers, files)
    )

    reporter.success('write out nginx configuration')
  },
}

function mapObjectValues<V, T>(
  obj: Record<string | number | symbol, V>,
  transform: (value: V) => T
): Record<string | number | symbol, T> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, transform(v)])
  )
}

export const { onCreateWebpackConfig } = Node
export const { onPostBuild } = Node
