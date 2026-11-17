import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { handleMessage, parseTopic } from '../src/mqtt/subscriber.js';
import { makeMedic, makePatient } from './helpers.js';

const T = '2026-11-14T10:00:00Z';
const count = async () => (await prisma.heartRate.count()) + (await prisma.bodyTemp.count()) + (await prisma.bloodOxygen.count());

describe('parseTopic', () => {
    it.each([
        ['pulsars/12/vitals/hr', { userId: 12, type: 'hr' }],
        ['pulsars/1/vitals/bt', { userId: 1, type: 'bt' }],
        ['pulsars/2147483647/vitals/bo', { userId: 2147483647, type: 'bo' }],
    ])('accepts %s', (topic, expected) => {
        expect(parseTopic(topic)).toEqual(expected);
    });

    it.each([
        'pulsars/1/vitals', 'pulsars/1/vitals/hr/extra', 'other/1/vitals/hr', 'pulsars/1/readings/hr',
        'pulsars/abc/vitals/hr', 'pulsars/0/vitals/hr', 'pulsars/01/vitals/hr', 'pulsars/-1/vitals/hr',
        'pulsars/1e3/vitals/hr', 'pulsars/2147483648/vitals/hr', 'pulsars/1/vitals/xx', 'pulsars/1/vitals/HR', '',
    ])('rejects "%s"', (topic) => {
        expect(parseTopic(topic)).toBeNull();
    });
});

describe('handleMessage', () => {
    it('stores a valid reading and updates the average', async () => {
        const u = await makePatient();
        expect(await handleMessage(`pulsars/${u.id}/vitals/hr`, JSON.stringify({ value: 61, recordedAt: T }))).toBe('stored');
        expect(await handleMessage(`pulsars/${u.id}/vitals/bt`, Buffer.from(JSON.stringify({ value: 36.5, recordedAt: T })))).toBe('stored');
        expect(await prisma.heartRate.count()).toBe(1);
        expect(await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ avgHr: 61, hrCount: 1, avgBt: 36.5 });
    });

    it('treats a redelivered message (QoS 1) as a duplicate, without double counting', async () => {
        const u = await makePatient();
        const payload = JSON.stringify({ value: 61, recordedAt: T });
        expect(await handleMessage(`pulsars/${u.id}/vitals/hr`, payload)).toBe('stored');
        expect(await handleMessage(`pulsars/${u.id}/vitals/hr`, payload)).toBe('duplicate');
        expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).hrCount).toBe(1);
    });

    it('takes the vital type from the topic, never from the payload', async () => {
        const u = await makePatient();
        expect(await handleMessage(`pulsars/${u.id}/vitals/bt`, JSON.stringify({ value: 36.5, type: 'hr', recordedAt: T }))).toBe('stored');
        expect(await prisma.bodyTemp.count()).toBe(1);
        expect(await prisma.heartRate.count()).toBe(0);
    });

    it('drops bad messages without throwing and stores nothing', async () => {
        const u = await makePatient();
        const medic = await makeMedic();
        const good = JSON.stringify({ value: 61, recordedAt: T });
        const cases: [string, string][] = [
            ['pulsars/abc/vitals/hr', good], // bad topic
            [`pulsars/${u.id}/vitals/xx`, good], // bad vital type
            [`pulsars/${u.id}/vitals/hr`, 'not json'],
            [`pulsars/${u.id}/vitals/hr`, '[1,2]'],
            [`pulsars/${u.id}/vitals/hr`, 'null'],
            [`pulsars/${u.id}/vitals/hr`, JSON.stringify({ value: 999, recordedAt: T })], // out of range
            [`pulsars/${u.id}/vitals/hr`, JSON.stringify({ value: '61', recordedAt: T })],
            [`pulsars/${u.id}/vitals/hr`, JSON.stringify({ value: 61, extra: 1 })], // unknown key
            [`pulsars/${u.id}/vitals/hr`, JSON.stringify({ value: 61, recordedAt: '2099-01-01T00:00:00Z' })], // future
            ['pulsars/999/vitals/hr', good], // unknown user
            [`pulsars/${medic.id}/vitals/hr`, good], // not a patient
            ['pulsars/2147483647/vitals/hr', good], // id at the int4 limit, no such user
        ];
        for (const [topic, payload] of cases) {
            await expect(handleMessage(topic, payload), `${topic} ${payload}`).resolves.toBe('dropped');
        }
        expect(await count()).toBe(0);
    });
});
