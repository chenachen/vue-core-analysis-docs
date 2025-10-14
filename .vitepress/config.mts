import { defineConfig } from 'vitepress'
import { withMermaid } from "vitepress-plugin-mermaid";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: '/vue-core-analysis-docs/',
  title: "Vue3源码解析",
  srcDir: './src',
  description: "深入探索 Vue 3 响应式系统、渲染机制和编译优化的核心工作原理",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '主页', link: '/' },
      { text: '文档', link: '/overview' }
    ],

    sidebar: [
      {
        text: '总览',
        link: '/overview'
      },
      {
        text: '响应式原理',
        items: [
          { text: '总览', link: '/reactivity/overview' },
          { text: '从Demo开始', link: '/reactivity/demo' },
          { text: 'Reactive', link: '/reactivity/reactive' },
          { text: 'Ref', link: '/reactivity/ref' },
          { text: 'Effect&Dep', link: '/reactivity/effectAndDep' },
          { text: 'Computed', link: '/reactivity/computed' },
          { text: 'Watch', link: '/reactivity/watch' },
          { text: 'EffectScope', link: '/reactivity/effectScope' },
        ]
      },
      {
        text: '运行时',
        items: [
          { text: '总览', link: '/runtime/overview' },
          {
            text: '从createApp开始',
            items: [
              {
                text: '总览',
                link: '/runtime/entry/overview'
              },
              { text: 'CreateApp', link: '/runtime/entry/createApp' },
              { text: '组件挂载', link: '/runtime/entry/mount' }
            ]
          },
          {
            text: 'VNode 与组件实例',
            items: [
              {
                text: '总览',
                link: '/runtime/component/overview'
              },
              {
                text: '虚拟DOM',
                link: '/runtime/component/vNode'
              },
              {
                text: '组件实例',
                link: '/runtime/component/component'
              },
            ]
          },
          {
            text: 'Diff算法',
            items: [
              {
                text: '总览',
                link: '/runtime/diff/overview'
              },
              {
                text: 'Patch',
                link: '/runtime/diff/patch'
              },
              {
                text: '核心Diff算法',
                link: '/runtime/diff/algorithm'
              }
            ]
          },
          {
            text: '调度与更新',
            items: [
              {
                text: '总览',
                link: '/runtime/scheduler/overview'
              },
              {
                text: '调度器',
                link: '/runtime/scheduler/scheduler'
              }
            ]
          },
          {
            text: '生命周期',
            items: [
              {
                text: '总览',
                link: '/runtime/lifecycle/overview'
              },
              {
                text: '生命周期实现',
                link: '/runtime/lifecycle/lifecycle'
              }
            ]
          },
          {
            text: '自定义渲染器',
            items: [
              {
                text: '总览',
                link: '/runtime/renderer/overview'
              },
              {
                text: '自定义渲染器实现',
                link: '/runtime/renderer/renderer'
              }
            ]
          }
        ]
      },
      {
        text: '编译器',
        items: [
          { text: '总览', link: '/compiler/overview' },
          {
            text: 'Compiler-Core',
            items: [
              {
                text: '总览',
                link: '/compiler/core/overview'
              },
              { text: 'Parser', link: '/compiler/core/parser' },
              { text: 'AST', link: '/compiler/core/ast' },
              { text: 'Transform', link: '/compiler/core/transform' },
              { text: 'Codegen', link: '/compiler/core/codegen' }
            ]
          },
          {
            text: 'Compiler-DOM',
            items: [
              {
                text: '总览',
                link: '/compiler/dom/overview'
              },
              { text: 'RuntimeHelpers', link: '/compiler/dom/runtimeHelpers' },
              { text: 'v-html', link: '/compiler/dom/vHtml' },
              { text: 'v-model', link: '/compiler/dom/vModel' },
              { text: 'v-on', link: '/compiler/dom/vOn' },
              { text: 'Transition', link: '/compiler/dom/transition' },
            ]
          },
          {
            text: 'Compiler-SFC',
            items: [
              {
                text: '总览',
                link: '/compiler/sfc/overview'
              },
              { text: 'Parse', link: '/compiler/sfc/parse' },
              { text: 'Template', link: '/compiler/sfc/template' },
              { text: 'Script', link: '/compiler/sfc/script' },
              { text: 'style', link: '/compiler/sfc/style' },
              { text: 'rewriteDefault', link: '/compiler/sfc/rewriteDefault' },
            ]
          }
        ]
      },
      {
        text: '写在最后',
        link: '/finalThoughts'
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/chenachen/vue-core-analysis' }
    ]
  }
})
