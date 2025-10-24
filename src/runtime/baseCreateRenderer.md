# 渲染器

在讲渲染器之前，我们先来了解一下什么是渲染器。
渲染器（Renderer）是一个负责将虚拟DOM转换为实际DOM的模块。
在不同的平台上，渲染器的实现会有所不同，比如在浏览器环境下，我们使用的是DOM渲染器，而在移动端，我们可能使用的是原生渲染器。

而Vue3在设计之初，就考虑到了跨平台的需求，因此它采用了工厂函数的设计模式来创建渲染器。
这使得我们可以根据不同的平台，传入不同的API，从而创建出适合该平台的渲染器。

这就是为何运行时核心包（runtime-core）并不直接依赖于浏览器API，而是通过抽象的方式来实现渲染器。

## 创建渲染器

本系列文章，我们主要关注浏览器端的实现，所以我们会重点关注`runtime-dom`包中的渲染器实现。

在上文中，我们提到过`createApp`函数是应用的入口，而在`createApp`函数内部，会调用`createRenderer`函数来创建渲染器。


```ts
// packages/runtime-dom/src/index.ts
function ensureRenderer() {
    return (
        renderer ||
        (renderer = createRenderer<Node, Element | ShadowRoot>(rendererOptions))
    )
}
```

而`createRenderer`函数的实现位于`runtime-core`包中，它接受一组平台相关的API作为参数，然后返回一个包含`render`、`createApp`以及`hydrate`方法的对象。

```ts
// packages/runtime-core/src/renderer.ts
export function createRenderer<
  HostNode = RendererNode,
  HostElement = RendererElement,
>(options: RendererOptions<HostNode, HostElement>): Renderer<HostElement> {
  return baseCreateRenderer<HostNode, HostElement>(options)
}
```

在浏览器平台中，传入的`rendererOptions`是个常量，包含了包括创建元素、设置属性、添加事件等一系列操作DOM的函数。

```ts
const rendererOptions = /*@__PURE__*/ extend({ patchProp }, nodeOps)
```

- `patchProp`用于设置元素的属性, 在`packages/runtime-dom/src/patchProp.ts`
- `nodeOps`则包含了创建元素、插入元素等操作DOM的方法, 在`packages/runtime-dom/src/nodeOps.ts`

我们挑选两个常用的方法来看看它们的实现。

### `patchProp`

```ts
export const patchProp: DOMRendererOptions['patchProp'] = (
  el,
  key,
  prevValue,
  nextValue,
  namespace,
  parentComponent,
) => {
  const isSVG = namespace === 'svg'
  if (key === 'class') {
    patchClass(el, nextValue, isSVG)
  } else if (key === 'style') {
    patchStyle(el, prevValue, nextValue)
  } else if (isOn(key)) {
    // ignore v-model listeners
    if (!isModelListener(key)) {
      patchEvent(el, key, prevValue, nextValue, parentComponent)
    }
  } else if (
    key[0] === '.'
      ? ((key = key.slice(1)), true)
      : key[0] === '^'
        ? ((key = key.slice(1)), false)
        : shouldSetAsProp(el, key, nextValue, isSVG)
  ) {
    patchDOMProp(el, key, nextValue, parentComponent)
    // #6007 also set form state as attributes so they work with
    // <input type="reset"> or libs / extensions that expect attributes
    // #11163 custom elements may use value as an prop and set it as object
    if (
      !el.tagName.includes('-') &&
      (key === 'value' || key === 'checked' || key === 'selected')
    ) {
      patchAttr(el, key, nextValue, isSVG, parentComponent, key !== 'value')
    }
  } else if (
    // #11081 force set props for possible async custom element
    (el as VueElement)._isVueCE &&
    (/[A-Z]/.test(key) || !isString(nextValue))
  ) {
    patchDOMProp(el, camelize(key), nextValue, parentComponent, key)
  } else {
    // special case for <input v-model type="checkbox"> with
    // :true-value & :false-value
    // store value as dom properties since non-string values will be
    // stringified.
    if (key === 'true-value') {
      ;(el as any)._trueValue = nextValue
    } else if (key === 'false-value') {
      ;(el as any)._falseValue = nextValue
    }
    patchAttr(el, key, nextValue, isSVG, parentComponent)
  }
}
```

根据传入的`key`，`patchProp`会调用不同的函数来处理属性的更新，比如`patchClass`用于更新类名，`patchStyle`用于更新样式，`patchEvent`用于更新事件监听器等。这些相关的兼容方法都定义在`packages/runtime-dom/src/modules`中。

### `nodeOps.createElement`

```ts
export const nodeOps: Omit<RendererOptions<Node, Element>, 'patchProp'> = {
  createElement: (tag, namespace, is, props): Element => {
    const el =
      namespace === 'svg'
        ? doc.createElementNS(svgNS, tag)
        : namespace === 'mathml'
          ? doc.createElementNS(mathmlNS, tag)
          : is
            ? doc.createElement(tag, { is })
            : doc.createElement(tag)

    if (tag === 'select' && props && props.multiple != null) {
      ;(el as HTMLSelectElement).setAttribute('multiple', props.multiple)
    }

    return el
  },
}
```

`createElement`方法用于创建一个新的DOM元素。它根据传入的标签名、命名空间以及其他属性来创建相应的元素节点。

**正是通过这种方式，Vue3实现了一个高度可定制化的渲染器，使得它能够轻松地适应不同的平台需求。**

## `render`方法

`createApp`已经在上文中提到过，`hydrate`和服务器渲染相关，这里不再赘述。我们重点来看一下渲染器中的另一个重要方法——`render`。

`render`方法是渲染器的核心，它负责将虚拟DOM渲染为真实DOM。在`runtime-core`包中，`render`方法的实现依赖于`patch`函数，该函数会根据虚拟DOM的变化来更新真实DOM。

```ts
// packages/runtime-core/src/renderer.ts
let isFlushing = false
const render: RootRenderFunction = (vnode, container, namespace) => {
    if (vnode == null) {
        if (container._vnode) {
            unmount(container._vnode, null, null, true)
        }
    } else {
        patch(
            container._vnode || null,
            vnode,
            container,
            null,
            null,
            null,
            namespace,
        )
    }
    container._vnode = vnode
    if (!isFlushing) {
        isFlushing = true
        flushPreFlushCbs()
        flushPostFlushCbs()
        isFlushing = false
    }
}
```

`render`方法接受三个参数：
- `vnode`：要渲染的虚拟节点
- `container`：渲染的目标容器
- `namespace`：命名空间（可选）

执行流程：
1. 如果`vnode`为`null`，则表示需要卸载当前的虚拟节点。
2. 否则，调用`patch`函数，将旧的虚拟节点和新的虚拟节点进行比较，并更新真实DOM。
3. 最后，更新容器的`_vnode`属性，保存当前的虚拟节点。
4. 如果当前没有正在刷新，则执行预刷新和后刷新回调。`flushPreFlushCbs`和`flushPostFlushCbs`分别用于处理预刷新和后刷新回调函数,是调度器相关的内容，在`packages/runtime-core/src/scheduler.ts`。


