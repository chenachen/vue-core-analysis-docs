# Reactive

我们从`reactive`开始，reactive的实现非常简单，就是通过Proxy来拦截对象的get和set操作，从而实现依赖收集和触发更新。

## reactive函数

打开`packages/reactivity/src/reactive.ts`，我们可以看到reactive的实现：

```ts
export function reactive(target: object) {
    if (isReadonly(target)) {
        return target
    }
    return createReactiveObject(
        target,
        false,
        mutableHandlers,
        mutableCollectionHandlers,
        reactiveMap,
    )
}
```

我们看到reactive函数的实现非常简单，就是调用了`createReactiveObject`函数，并传入了一些参数。

这是是因为reactive函数还有一些变体，比如`shallowReactive`、`readonly`、`shallowReadonly`，它们的实现都是调用
`createReactiveObject`函数，只是传入的参数不同。
所以我们接下来继续看`createReactiveObject`函数的实现。

## createReactiveObject函数

```ts
function createReactiveObject(
    target: Target,
    isReadonly: boolean,
    baseHandlers: ProxyHandler<any>,
    collectionHandlers: ProxyHandler<any>,
    proxyMap: WeakMap<Target, any>,
) {
    // reactive需要传入一个对象
    if (!isObject(target)) {
        if (__DEV__) {
            warn(
                `value cannot be made ${isReadonly ? 'readonly' : 'reactive'}: ${String(
                    target,
                )}`,
            )
        }
        return target
    }
    // target is already a Proxy, return it.
    // exception: calling readonly() on a reactive object
    // 如果已经被代理，并且不是尝试用readonly()传入一个响应式对象 例子 readonly(reactive({}))
    if (
        target[ReactiveFlags.RAW] &&
        !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
    ) {
        return target
    }
    // only specific value types can be observed.
    // 获取当前对象的类型，如果时非法对象则直接返回该值
    const targetType = getTargetType(target)
    if (targetType === TargetType.INVALID) {
        return target
    }
    // target already has corresponding Proxy
    // 如果已经被代理过了，则直接返回该代理对象
    const existingProxy = proxyMap.get(target)
    if (existingProxy) {
        return existingProxy
    }
    // 创建代理对象，并基于源对象存储在proxyMap
    const proxy = new Proxy(
        target,
        targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers,
    )
    proxyMap.set(target, proxy)
    return proxy
}
```

`createReactiveObject`函数的实现也很简单，主要做了以下几件事：

1. 检查传入的参数是否是对象，如果不是对象则直接返回该值。
2. 检查传入的对象是否已经被代理过，如果已经被代理过则直接返回该代理对象。
3. 检查传入的对象是否是合法的对象，如果不是合法对象则直接返回该值。
4. 创建一个新的Proxy对象，并将其存储在`proxyMap`中，最后返回该Proxy对象。
5. 根据对象的类型选择不同的handler，如果是集合类型（Map、Set等）则使用`collectionHandlers`，否则使用`baseHandlers`。

## Handlers

**其实不管是`collectionHandlers`还是`baseHandlers`，它们的实现都是类似的，都是通过Proxy拦截对象的get和set等操作，从而实现依赖收集和触发更新。
所以我们重点看`baseHandlers`的实现。其他的我在我的源码仓库中都有注释，感兴趣的可以去看看。**

我们可以看到在`reactive`函数中传入的`mutableHandlers`，它就是`baseHandlers`，我们打开
`packages/reactivity/src/baseHandlers.ts`，可以看到它的实现：

```ts
export const mutableHandlers: ProxyHandler<object> =
    /*@__PURE__*/ new MutableReactiveHandler()
```

`MutableReactiveHandler`是一个继承`BaseReactiveHandler`的类，封装了对普通对象的拦截逻辑，包括`get`、`set`、`deleteProperty`
等方法。

### 我们首先看`get`操作

```ts
class BaseReactiveHandler implements ProxyHandler<Target> {
    constructor(
        protected readonly _isReadonly = false,
        protected readonly _isShallow = false,
    ) {
    }

    get(target: Target, key: string | symbol, receiver: object): any {
        if (key === ReactiveFlags.SKIP) return target[ReactiveFlags.SKIP]

        const isReadonly = this._isReadonly,
            isShallow = this._isShallow

        // 返回特定值
        if (key === ReactiveFlags.IS_REACTIVE) {
            // 是否响应式对象
            return !isReadonly
        } else if (key === ReactiveFlags.IS_READONLY) {
            // 是否只读
            return isReadonly
        } else if (key === ReactiveFlags.IS_SHALLOW) {
            // 是否浅层监听对象
            return isShallow
        } else if (key === ReactiveFlags.RAW) {
            if (
                receiver ===
                (isReadonly
                        ? isShallow
                            ? shallowReadonlyMap
                            : readonlyMap
                        : isShallow
                            ? shallowReactiveMap
                            : reactiveMap
                ).get(target) ||
                /**
                 * 如果receiver和target有着相同的原型链，同样返回target
                 * 测试用例：reactive.spect.ts -> toRaw on user Proxy wrapping reactive
                 */
                Object.getPrototypeOf(target) === Object.getPrototypeOf(receiver)
            ) {
                // 返回源对象
                return target
            }
            // early return undefined
            return
        }

        // 判断是否数组
        const targetIsArray = isArray(target)

        if (!isReadonly) {
            let fn: Function | undefined
            // 判断是否数组的原生方法
            if (targetIsArray && (fn = arrayInstrumentations[key])) {
                // 是的话返回被劫持的原生方法，这些方法已经被重新定义过，所以无需继续往下走
                return fn
            }
            // 劫持hasOwnProperty方法
            if (key === 'hasOwnProperty') {
                return hasOwnProperty
            }
        }

        // 获取值
        const res = Reflect.get(
            target,
            key,
            isRef(target) ? target : receiver,
        )

        // 先判断是否Symbol，如果是的话判断是否Symbol对象自有属性方法，如果否的话判断是否不追踪的key值
        if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
            return res
        }

        // 依赖追踪
        if (!isReadonly) {
            track(target, TrackOpTypes.GET, key)
        }

        // 浅层监听直接返回
        if (isShallow) {
            return res
        }

        if (isRef(res)) {
            // 如果是ref，则解包
            // ref unwrapping - 跳过 Array + integer 键的 解包。
            return targetIsArray && isIntegerKey(key) ? res : res.value
        }

        // 如果值依然是对象，则继续深度追踪或者深度只读
        if (isObject(res)) {
            return isReadonly ? readonly(res) : reactive(res)
        }

        return res
    }
}
```

我们可以看到代码的前半段到`const targetIsArray = isArray(target)`之前，handler对一些特定的key返回特定的value。

这些key和value一般来说我们不会直接用到，而是用于辅助一些工具函数做判断，例如

- `isReactive`
    ```ts
    export function isReactive(value: unknown): boolean {
      if (isReadonly(value)) {
        return isReactive((value as Target)[ReactiveFlags.RAW])
      }
      return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
    }
    ```
- `toRaw`
    ```ts
    export function toRaw<T>(observed: T): T {
        const raw = observed && (observed as Target)[ReactiveFlags.RAW]
        return raw ? toRaw(raw) : observed
    }
    ```
- `isReadonly`等等

然后接着`const targetIsArray = isArray(target)`往下走

```ts
// 判断是否数组
const targetIsArray = isArray(target)

if (!isReadonly) {
    let fn: Function | undefined
    // 判断是否数组的原生方法
    if (targetIsArray && (fn = arrayInstrumentations[key])) {
        // 是的话返回被劫持的原生方法，这些方法已经被重新定义过，所以无需继续往下走
        return fn
    }
    // 劫持hasOwnProperty方法
    if (key === 'hasOwnProperty') {
        return hasOwnProperty
    }
}
```

这里主要是处理数组的原生方法和`hasOwnProperty`方法。arrayInstrumentations的处理在
`packages/reactivity/src/arrayInstrumentations.ts`，感兴趣的可以去看看。

接着往下走

```ts
// 获取值
const res = Reflect.get(
    target,
    key,
    isRef(target) ? target : receiver,
)

// 先判断是否Symbol，如果是的话判断是否Symbol对象自有属性方法，如果否的话判断是否不追踪的key值
if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
    return res
}
```

这里主要是通过Reflect.get获取值，然后判断key是否是Symbol或者不追踪的key值，如果是的话直接返回值，不进行依赖收集。

至于`isRef(target) ? target : receiver`
这个判断，讲解起来有点复杂，为了了不打断主线流程，我把它单独拿出来讲，[点击这跳转](#receiver)

接着往下走

```ts
// 依赖追踪
if (!isReadonly) {
    track(target, TrackOpTypes.GET, key)
}

// 浅层监听直接返回
if (isShallow) {
    return res
}

if (isRef(res)) {
    // 如果是ref，则解包
    // ref unwrapping - 跳过 Array + integer 键的 解包。
    return targetIsArray && isIntegerKey(key) ? res : res.value
}

// 如果值依然是对象，则继续深度追踪或者深度只读
if (isObject(res)) {
    return isReadonly ? readonly(res) : reactive(res)
}

return res
```

这里主要做了以下几件事：

- 如果不是只读对象，则进行依赖收集。
- 如果是浅层监听，则直接返回值。
- 如果值是ref，则进行解包。
- 如果值是对象，则继续进行深度追踪或者深度只读。
- 最后返回值。

到了这里，我们已经看完了`get`操作的实现，接下来我们看`set`操作的实现。

### `set`操作拦截

```ts
class MutableReactiveHandler extends BaseReactiveHandler {
    set(
        target: Record<string | symbol, unknown>,
        key: string | symbol,
        value: unknown,
        receiver: object,
    ): boolean {
        // 先记录旧的值
        let oldValue = target[key]
        if (!this._isShallow) {
            // 判断是不是只读
            const isOldValueReadonly = isReadonly(oldValue)
            if (!isShallow(value) && !isReadonly(value)) {
                oldValue = toRaw(oldValue)
                value = toRaw(value)
            }
            if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
                if (isOldValueReadonly) {
                    return false
                } else {
                    oldValue.value = value
                    return true
                }
            }
        } else {
            // in shallow mode, objects are set as-is regardless of reactive or not
        }

        const hadKey =
            isArray(target) && isIntegerKey(key)
                ? Number(key) < target.length
                : hasOwn(target, key)
        const result = Reflect.set(
            target,
            key,
            value,
            isRef(target) ? target : receiver,
        )
        if (target === toRaw(receiver)) {
            if (!hadKey) {
                trigger(target, TriggerOpTypes.ADD, key, value)
            } else if (hasChanged(value, oldValue)) {
                trigger(target, TriggerOpTypes.SET, key, value, oldValue)
            }
        }
        return result
    }
}
```

我们先看前`const hadKey = ...`之前的代码

这里主要是处理一些特殊情况，比如浅层监听、只读对象、ref对象等。

重点是这里

```ts
if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
    if (isOldValueReadonly) {
        return false
    } else {
        oldValue.value = value
        return true
    }
}
```

这里是对ref对象的特殊处理，如果旧值是ref对象，并且新值不是ref对象，则直接修改旧值的value属性，而不是替换整个ref对象。对应的例子如下：

```ts
const r = ref(1)
const obj = reactive({r})
obj.r = 2
console.log(r.value) // 2
```

然后我们从`const hadKey = ...`开始往下走

重点看下面这段代码

```ts
if (target === toRaw(receiver)) {
    if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, value)
    } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
    }
}
```

这里主要是触发依赖更新，只有当`target`和`receiver`的原始对象相等时，才会触发依赖更新。处理的场景在这个测试用例中：
`packages/reactivity/__tests__/reactive.spec.ts`

`mutation on objects using reactive as prototype should not trigger`

```ts
const observed = reactive({foo: 1})
const original = Object.create(observed)
let dummy
effect(() => (dummy = original.foo))
expect(dummy).toBe(1)
observed.foo = 2
expect(dummy).toBe(2)
original.foo = 3
expect(dummy).toBe(2)
original.foo = 4
expect(dummy).toBe(2)
```

至此，我们已经看完了`reactive`函数的实现。其他如`delete`、`has`、`ownKeys`等操作的实现和`get`、`set`类似，这里就不再赘述。

其他类型的数据比如数组，主要是根据每个数组方法的不同，去对数据数据是否需要深层监听、依赖收集等做不同的处理，感兴趣的可以去看看
`packages/reactivity/src/arrayInstrumentations.ts`。

而`collectionHandlers`主要是对`Map`、`Set`等集合类型的数据做处理，和`baseHandlers`类似，原理都一样的，这里也不再赘述。如果你读懂了
`baseHandlers`，那么`collectionHandlers`作为自己的练习题，应该不难读懂。

最后，我们来解释一下上面提到的那个问题：

### isRef(target) ? target : receiver 为何有这个判断 {#receiver}

在上面我们遗留了一个问题，就是为什么在`Reflect.get`中要判断`isRef(target) ? target : receiver`，而不是直接传入`receiver`。

```ts
const res = Reflect.get(
    target,
    key,
    isRef(target) ? target : receiver,
)
```

这个判断是针对`readonly(computed)`这种情况的，这种情况下如果不做以下判断，在`RefImpl`和`ComputedRefImpl`中的*
*this指向的是代理对象，而不是ref本身**

这会导致在`RefImpl`和`ComputedRefImpl`内部get value()方法中需要通过toRaw方法获取到原始对象，否则直接调用this会调用到代理对象上

改动的commit在这[Refactor reactivity system to use version counting and doubly-linked list tracking](https://github.com/vuejs/core/pull/10397/commits/1318017d111ded1977daed0db4e301f676a78628)

本质在于this指向问题

例子：

```js
const target = {
    _name: 'Target',
    get name() {
        console.log(this === proxy, this === target) // 这里可以看到输出 true false
        return this._name; // this 的值由 receiver 决定！
    }
};

const proxy = new Proxy(target, {
    get(target, prop, receiver) {
        return Reflect.get(target, prop, receiver); // 传递 receiver
    }
});

console.log(proxy.name);
```

绝大部分场景其实都没有问题，把 isRef(target) ? target : receiver 改成 receiver，仅有一个测试用例会报错

`packages/reactivity/__tests__/readonly.spec.ts 'calling readonly on computed should allow computed to set its private properties'`

```ts
const r = ref<boolean>(false)
const c = computed(() => r.value)
const rC = readonly(c)
r.value = true
expect(rC.value).toBe(true)
```

在这个例子中，如果传递的是receiver，那么在**computed的get函数中this指向的是代理对象，而不是ref本身**

**r.value的变更会触发computed的重新计算，但是由于this指向错误，refreshComputed在执行computed._value = value时
computed其实是readonly对象，所以setter不可用，从而导致computed的值不会更新**

```ts
// packages/reactivity/src/computed.ts
export class ComputedRefImpl<T = any> implements Subscriber {

    get value(): T {
        const link = __DEV__
            ? this.dep.track({
                target: this,
                type: TrackOpTypes.GET,
                key: 'value',
            })
            : this.dep.track()
        // 这里的this指向了代理对象rC，它是个readonly对象
        refreshComputed(this)
        if (link) {
            link.version = this.dep.version
        }
        return this._value
    }

}

// packages/reactivity/src/effect.ts
export function refreshComputed(computed: ComputedRefImpl): undefined {
    // ...
    try {
        prepareDeps(computed)
        const value = computed.fn(computed._value)
        if (dep.version === 0 || hasChanged(value, computed._value)) {
            computed.flags |= EffectFlags.EVALUATED
            // 这里的computed就是上面这个传入的this，是个readonly对象
            // 所以这里设值会失败
            // 用例就会报错
            computed._value = value
            dep.version++
        }
    } catch (e) {
        // ...
    }
}
```

所以rC.value永远是undefined，这个测试用例就会报错

## 总结

到这里，我们已经看完了`reactive`函数的实现。下一节，我们将继续`ref`函数的实现解释。