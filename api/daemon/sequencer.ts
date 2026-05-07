/**
 * Closure form of a deferred runOpen invocation. Wrapping it as `() =>
 * Promise<void>` keeps the sequencer's internals decoupled from the larger
 * `ArmCycleInputs` type — it only needs to know how to invoke a deferred
 * cycle, not its shape.
 */
export type DeferredOpen = () => Promise<void>;

/**
 * Single-slot lock + FIFO queue that serializes zone watering. Acquire the
 * lock before opening a relay; the lock is held until the close completes
 * (success or failure). Concurrent attempts to fire while the lock is held
 * are queued and pumped one at a time after each release.
 *
 * The sequencer is purely synchronous over its own state — it doesn't await
 * anything internally. Callers drive the lifecycle: `tryAcquire` to attempt,
 * `enqueue` to defer when held, `releaseAndDequeue` after the close finishes
 * to either transfer the lock to the next deferred entry or free it.
 */
export class WateringSequencer {
    private isLocked = false;
    private readonly queue: DeferredOpen[] = [];

    /**
     * Attempts to take the lock. Returns true if it was free and is now held
     * by the caller; false if it was already held. Callers that get false
     * should `enqueue` instead.
     */
    tryAcquire(): boolean {
        if (this.isLocked) return false;
        this.isLocked = true;
        return true;
    }

    /**
     * Adds a deferred runOpen invocation to the FIFO queue. The lock is
     * assumed to already be held (by whoever's currently watering); the
     * caller will be invoked when the lock is released and there's nothing
     * ahead of them.
     */
    enqueue(deferred: DeferredOpen): void {
        this.queue.push(deferred);
    }

    /**
     * Atomically transfers the lock to the next queued invocation, if any:
     * pops the head of the queue and returns it (lock stays held — the
     * caller is responsible for invoking the returned deferred). When the
     * queue is empty, releases the lock and returns null.
     *
     * Combining release + dequeue in one operation prevents a race where
     * the lock briefly looks free between dequeue and the next acquire.
     */
    releaseAndDequeue(): DeferredOpen | null {
        const next = this.queue.shift();
        if (next === undefined) {
            this.isLocked = false;
            return null;
        }
        return next;
    }

    /** Whether the lock is currently held. Exposed for tests + log lines. */
    isHeld(): boolean {
        return this.isLocked;
    }

    /** Number of deferred invocations waiting behind the current holder. */
    getQueueDepth(): number {
        return this.queue.length;
    }
}
