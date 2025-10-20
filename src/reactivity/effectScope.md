# EffectScope

Vue3提供了一个api`effectScope`,创建一个 effect 作用域，可以捕获其中所创建的响应式副作用，这样捕获到的副作用可以一起处理。
对于该 API 的使用细节，请查阅[RFC](https://github.com/vuejs/rfcs/blob/master/active-rfcs/0041-reactivity-effect-scope.md)。

更具体的场景，
- 组件会创建自己的作用域
- 比如`pinia`和`vueuse`等一些库就使用这个API去统一管理一些响应式副作用。

如果你也考虑使用这个API去封装一些功能，可以参考使用。

下面我们来看看`effectScope`的实现。

## EffectScope 类

`effectScope`函数的实现如下：

```ts
export function effectScope(detached?: boolean): EffectScope {
    return new EffectScope(detached)
}
```

其实就是创建了一个`EffectScope`实例。

所以我们直接看`EffectScope`类的实现，还是先看看属性：

```ts
export class EffectScope {
    /**
     * 当前作用域是否活跃
     * @internal
     */
    private _active = true
    /**
     * @internal track `on` calls, allow `on` call multiple times
     */
    private _on = 0
    /**
     * 存储的effect
     * @internal
     */
    effects: ReactiveEffect[] = []
    /**
     * @internal
     */
    cleanups: (() => void)[] = []

    // 是否暂停状态
    private _isPaused = false

    /**
     * only assigned by undetached scope
     * 父作用域
     * @internal
     */
    parent: EffectScope | undefined
    /**
     * record undetached scopes
     * 记录相关联的作用域
     * @internal
     */
    scopes: EffectScope[] | undefined
    /**
     * track a child scope's index in its parent's scopes array for optimized
     * removal
     * 记录本作用域在父作用域的索引，方便优化移除操作
     * @internal
     */
    private index: number | undefined

    constructor(public detached = false) {
        // 将当前活跃的作用域设置为父作用域
        this.parent = activeEffectScope
        if (!detached && activeEffectScope) {
            // 记录当前作用域在父作用域中的索引
            this.index =
                (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(
                    this,
                ) - 1
        }
    }
}
```

我们来看这些属性：
- `_active`：表示当前作用域是否活跃，默认为`true`。
- `_on`：用于跟踪`on`调用的次数，允许多次调用`on`方法。
- `effects`：存储在该作用域中创建的所有响应式副作用（`ReactiveEffect`实例）。
- `cleanups`：存储在该作用域中注册的清理函数。
- `_isPaused`：表示当前作用域是否处于暂停状态。
- `parent`：指向父作用域的引用，如果该作用域是未分离的（undetached），则会有一个父作用域。
- `scopes`：记录与该作用域相关联的子作用域。
- `index`：记录该作用域在其父作用域的`scopes`数组中的索引，以便优化移除操作。
- `detached`：表示该作用域是否为分离状态，默认为`false`。
- 在构造函数中，如果当前作用域不是分离状态且存在活跃的父作用域，则将当前作用域添加到父作用域的`scopes`数组中，并记录其索引。

### `pause` 方法

```ts
class EffectScope {
    pause(): void {
        // 如果是活跃状态
        if (this._active) {
            // 设为暂停状态
            this._isPaused = true
            let i, l
            if (this.scopes) {
                // 遍历相关联的作用域，都设置为暂停状态
                for (i = 0, l = this.scopes.length; i < l; i++) {
                    this.scopes[i].pause()
                }
            }
            // 将包含的effects全部设为暂停
            for (i = 0, l = this.effects.length; i < l; i++) {
                this.effects[i].pause()
            }
        }
    }
}
```

`pause`方法用于暂停当前作用域及其包含的所有子作用域和响应式副作用。如果当前作用域是活跃状态，则将其设置为暂停状态，并递归地暂停所有相关联的子作用域和包含的响应式副作用。

### `resume` 方法

```ts
class EffectScope {
    /**
     * Resumes the effect scope, including all child scopes and effects.
     */
    resume(): void {
        // 如果是活跃状态
        if (this._active) {
            // 如果是暂停中
            if (this._isPaused) {
                // 暂停状态设为false
                this._isPaused = false
                let i, l
                if (this.scopes) {
                    // 回复相关联的作用域
                    for (i = 0, l = this.scopes.length; i < l; i++) {
                        this.scopes[i].resume()
                    }
                }
                // 将包含的effects的状态也恢复
                for (i = 0, l = this.effects.length; i < l; i++) {
                    this.effects[i].resume()
                }
            }
        }
    }
}
```

`resume`方法用于恢复当前作用域及其包含的所有子作用域和响应式副作用。如果当前作用域是活跃状态且处于暂停状态，则将其暂停状态设为`false`，并递归地恢复所有相关联的子作用域和包含的响应式副作用。

### `stop` 方法

```ts
class EffectScope {
    stop(fromParent?: boolean): void {
        // 如果是活跃状态
        if (this._active) {
            // 将活跃状态置为false
            this._active = false
            // 停止包含的effects
            let i, l
            for (i = 0, l = this.effects.length; i < l; i++) {
                this.effects[i].stop()
            }
            this.effects.length = 0

            // 调用清理函数
            for (i = 0, l = this.cleanups.length; i < l; i++) {
                this.cleanups[i]()
            }
            this.cleanups.length = 0

            // 停止相关联的作用域
            if (this.scopes) {
                for (i = 0, l = this.scopes.length; i < l; i++) {
                    this.scopes[i].stop(true)
                }
                this.scopes.length = 0
            }

            // nested scope, dereference from parent to avoid memory leaks
            // 如果不是分离的作用域，并且有父作用域，并且不是从父作用域调用的
            if (!this.detached && this.parent && !fromParent) {
                // optimized O(1) removal
                // 优化O(1)移除
                const last = this.parent.scopes!.pop()
                // 如果移除的不是自己
                if (last && last !== this) {
                    // 将最后一个替换到自己的位置
                    this.parent.scopes![this.index!] = last
                    // 更新索引
                    last.index = this.index!
                }
            }
            this.parent = undefined
        }
    }
}
```

`stop`方法用于停止当前作用域及其包含的所有子作用域和响应式副作用。
- 如果当前作用域是活跃状态，则将其活跃状态设为`false`，并停止所有包含的响应式副作用，调用所有注册的清理函数，停止所有相关联的子作用域。
- 最后，如果该作用域不是分离状态且有父作用域，则将其从父作用域的`scopes`数组中移除。

### `on`和`off`方法

```ts
class EffectScope{
    prevScope: EffectScope | undefined
    /**
     * This should only be called on non-detached scopes
     * 这个方法只应该在非分离的作用域上调用
     * @internal
     */
    on(): void {
        if (++this._on === 1) {
            // 记录之前的活跃作用域
            this.prevScope = activeEffectScope
            // 将活跃作用域设为自己
            activeEffectScope = this
        }
    }

    /**
     * This should only be called on non-detached scopes
     * 这个方法只应该在非分离的作用域上调用
     * @internal
     */
    off(): void {
        if (this._on > 0 && --this._on === 0) {
            // 将活跃作用域重置为之前的值
            activeEffectScope = this.prevScope
            this.prevScope = undefined
        }
    }
}
```

`on`方法主要用于主动的将当前作用域设置为活跃作用域，并记录之前的活跃作用域，以便后续恢复。它通过增加`_on`计数器来跟踪调用次数，只有在第一次调用时才会更改活跃作用域。
`off`方法则用于恢复之前的活跃作用域，通过减少`_on`计数器来跟踪调用次数，只有在最后一次调用时才会恢复之前的活跃作用域。


## 总结
`effectScope`可以使我们更加方便的去管理响应式副作用，尤其是在组件卸载时，可以统一停止所有相关的副作用，避免内存泄漏。
代码实现也相对简单，这里就不过多赘述了。