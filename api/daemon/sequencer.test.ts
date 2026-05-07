import { describe, it, expect } from 'bun:test';
import { WateringSequencer, type DeferredOpen } from './sequencer';

const noopDeferred: DeferredOpen = async () => {};

describe('WateringSequencer', () => {
    it('grants the lock to the first acquirer and refuses subsequent ones until released', () => {
        const sequencer = new WateringSequencer();

        expect(sequencer.tryAcquire()).toBe(true);
        expect(sequencer.tryAcquire()).toBe(false);
        expect(sequencer.tryAcquire()).toBe(false);
    });

    it('releases the lock and returns null when the queue is empty', () => {
        const sequencer = new WateringSequencer();
        sequencer.tryAcquire();

        const next = sequencer.releaseAndDequeue();

        expect(next).toBeNull();
        expect(sequencer.isHeld()).toBe(false);
        expect(sequencer.tryAcquire()).toBe(true);
    });

    it('transfers the lock to the next deferred entry without freeing it', () => {
        const sequencer = new WateringSequencer();
        sequencer.tryAcquire();
        const deferred: DeferredOpen = async () => {};
        sequencer.enqueue(deferred);

        const next = sequencer.releaseAndDequeue();

        expect(next).toBe(deferred);
        expect(sequencer.isHeld()).toBe(true);
        expect(sequencer.tryAcquire()).toBe(false);
    });

    it('preserves FIFO order across multiple deferrals', () => {
        const sequencer = new WateringSequencer();
        sequencer.tryAcquire();
        const calls: string[] = [];
        const a: DeferredOpen = async () => { calls.push('A'); };
        const b: DeferredOpen = async () => { calls.push('B'); };
        const c: DeferredOpen = async () => { calls.push('C'); };
        sequencer.enqueue(a);
        sequencer.enqueue(b);
        sequencer.enqueue(c);

        const first = sequencer.releaseAndDequeue();
        const second = sequencer.releaseAndDequeue();
        const third = sequencer.releaseAndDequeue();

        expect(first).toBe(a);
        expect(second).toBe(b);
        expect(third).toBe(c);
    });

    it('reports the queue depth as entries are added and dequeued', () => {
        const sequencer = new WateringSequencer();
        sequencer.tryAcquire();

        expect(sequencer.getQueueDepth()).toBe(0);
        sequencer.enqueue(noopDeferred);
        expect(sequencer.getQueueDepth()).toBe(1);
        sequencer.enqueue(noopDeferred);
        expect(sequencer.getQueueDepth()).toBe(2);

        sequencer.releaseAndDequeue();
        expect(sequencer.getQueueDepth()).toBe(1);
        sequencer.releaseAndDequeue();
        expect(sequencer.getQueueDepth()).toBe(0);
    });

    it('keeps the lock held after returning the last queued entry, then releases on the next empty dequeue', () => {
        const sequencer = new WateringSequencer();
        sequencer.tryAcquire();
        sequencer.enqueue(noopDeferred);

        // First release transfers ownership to the only queued entry — lock stays held.
        const first = sequencer.releaseAndDequeue();
        expect(first).toBe(noopDeferred);
        expect(sequencer.isHeld()).toBe(true);

        // Next release with no remaining entries frees the lock.
        const second = sequencer.releaseAndDequeue();
        expect(second).toBeNull();
        expect(sequencer.isHeld()).toBe(false);
    });
});
