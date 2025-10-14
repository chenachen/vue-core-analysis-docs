# Ref

看完`reactive`函数后，我们发现`reactive`函数只能处理对象类型的数据，如果我们传入一个基本类型的数据，比如字符串、数字、布尔值等，是无法进行响应式处理的。
为了解决这个问题，Vue 3 提供了`ref`函数，用于创建一个包含基本类型数据的响应式引用。

## `ref`函数

打开`packages/reactivity/src/ref.ts`,你会发现`ref`函数的实现比`reactive`还简单

```ts
export function ref(value?: unknown) {
    return createRef(value, false)
}
```

这个函数调用了`createRef`函数，做这个封装的原因和`reactive`相似，`ref`也有 `shadownRef`这个变体，我们继续看下`createRef`函数的实现

```ts
function createRef(rawValue: unknown, shallow: boolean) {
    // 如果已经是ref了，直接返回
    if (isRef(rawValue)) {
        return rawValue
    }
    return new RefImpl(rawValue, shallow)
}
```

`createRef`函数首先检查传入的值是否已经是一个`ref`对象，如果是则直接返回该对象。否则，它会创建一个新的`RefImpl`实例。

我们都知道`ref`函数返回的是一个对象，这个对象有一个`value`属性，存储了传入的值。

对于需要代理多个属性的对象，我们使用`reactive`函数来创建响应式对象，但是`ref`只有一个`value`属性，所以我们只需要代理这个属性即可，
这就不需要用到`Proxy`，而是直接使用类的`getter`和`setter`来实现。

```ts
class RefImpl<T = any> {
    _value: T
    private _rawValue: T

    // 存储对应的依赖
    dep: Dep = new Dep()

    // 一些标识性的属性
    public readonly [ReactiveFlags.IS_REF] = true
    public readonly [ReactiveFlags.IS_SHALLOW]: boolean = false

    constructor(value: T, isShallow: boolean) {
        this._rawValue = isShallow ? value : toRaw(value)
        // 如果不是浅监听，则使用reactive进行深度监听
        this._value = isShallow ? value : toReactive(value)
        this[ReactiveFlags.IS_SHALLOW] = isShallow
    }

    get value() {
        // 依赖收集
        if (__DEV__) {
            this.dep.track({
                target: this,
                type: TrackOpTypes.GET,
                key: 'value',
            })
        } else {
            this.dep.track()
        }
        return this._value
    }

    set value(newValue) {
        const oldValue = this._rawValue
        // 判断是否直接使用传入的值
        const useDirectValue =
            this[ReactiveFlags.IS_SHALLOW] ||
            isShallow(newValue) ||
            isReadonly(newValue)
        newValue = useDirectValue ? newValue : toRaw(newValue)
        // 判断两个值是否相等，相等则不做其他处理，不相等则赋值并触发effect
        if (hasChanged(newValue, oldValue)) {
            this._rawValue = newValue
            this._value = useDirectValue ? newValue : toReactive(newValue)
            if (__DEV__) {
                this.dep.trigger({
                    target: this,
                    type: TriggerOpTypes.SET,
                    key: 'value',
                    newValue,
                    oldValue,
                })
            } else {
                this.dep.trigger()
            }
        }
    }
}
```

我们先来看看`RefImpl`类的属性：

- `_value`: 存储响应式的值
- `_rawValue`: 存储原始的值，用于比较新旧值是否变化
- `dep`: 用于存储依赖的集合，类似于`reactive`中的`targetMap`
- `ReactiveFlags.IS_REF`: 标识这是一个`ref`
- `ReactiveFlags.IS_SHALLOW`: 标识是否是浅监听
- `constructor`: 构造函数，接受一个值和一个布尔值`isShallow`，用于初始化`_value`和`_rawValue`
- 对于`_rawValue`，如果是浅监听则直接赋值，否则使用`toRaw`函数获取原始值
- 对于`_value`，如果是浅监听则直接赋值，否则使用`toReactive`函数进行深度监听

`toReactive`的实现非常简单，就是判断入参是否是对象，如果是对象则调用`reactive`函数，否则直接返回原始值

```ts
export const toReactive = <T extends unknown>(value: T): T =>
    isObject(value) ? reactive(value) : value
```

接下来我们看看`getter`和`setter`：

- `getter`：当访问`value`属性时，会进行依赖收集，调用`dep.track()`方法，然后返回响应式的值`_value`
```ts
// 依赖收集
if (__DEV__) {
    this.dep.track({
        target: this,
        type: TrackOpTypes.GET,
        key: 'value',
    })
} else {
    this.dep.track()
}
return this._value
```
- `setter`：当设置`value`属性时，会先保存旧值，然后判断新值是否需要直接使用（浅监听或只读），如果需要则直接赋值，否则使用`toRaw`获取原始值。
  接着比较新旧值是否变化，如果变化则更新`_rawValue`和`_value`，并触发依赖更新，调用`dep.trigger()`方法
```ts
const oldValue = this._rawValue

// 判断是否直接使用传入的值
const useDirectValue =
    this[ReactiveFlags.IS_SHALLOW] ||
    isShallow(newValue) ||
    isReadonly(newValue)

newValue = useDirectValue ? newValue : toRaw(newValue)

// 判断两个值是否相等，相等则不做其他处理，不相等则赋值并触发effect
if (hasChanged(newValue, oldValue)) {
    this._rawValue = newValue
    this._value = useDirectValue ? newValue : toReactive(newValue)
    if (__DEV__) {
        this.dep.trigger({
            target: this,
            type: TriggerOpTypes.SET,
            key: 'value',
            newValue,
            oldValue,
        })
    } else {
        this.dep.trigger()
    }
}
```

## 总结
`ref`的处理相对来说比较简单，主要是通过类的`getter`和`setter`来实现对单个属性的响应式处理。
它和`reactive`的核心思想是一样的，都是通过依赖收集和触发更新来实现响应式。对于入参是对象的情况，`ref`会使用`reactive`进行深度监听，从而实现对对象属性的响应式处理。

本文件还有其他方法例如
- `triggerRef`：主动触发传入的`ref`包含的依赖
- `customRef`：自定义`ref`的依赖收集和触发逻辑
- `toValue`、`proxyRefs`等等，感兴趣的同学可以自行查看源码。

下一节，我们暂且跳过`computed`，先看看`effect`如何与`Dep`组成Vue 3的响应式依赖核心处理逻辑。
