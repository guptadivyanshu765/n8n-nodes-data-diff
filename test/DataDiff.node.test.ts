import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { DataDiff } from '../nodes/DataDiff/DataDiff.node';

interface ItemParams {
	oldData?: unknown;
	newData?: unknown;
	maxDepth?: number;
	arrayMatchKeys?: { matchKey: Array<{ arrayPath: string; matchKey: string }> };
}

function createExecuteFunctions(
	items: INodeExecutionData[],
	paramsPerItem: ItemParams[],
	options: { continueOnFail?: boolean } = {},
): { fn: IExecuteFunctions; hints: unknown[] } {
	const hints: unknown[] = [];

	const fn = {
		getInputData: () => items,
		getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
			const params = paramsPerItem[itemIndex] ?? {};
			if (name === 'oldData') return params.oldData ?? fallback ?? {};
			if (name === 'newData') return params.newData ?? fallback ?? {};
			if (name === 'maxDepth') return params.maxDepth ?? fallback;
			if (name === 'arrayMatchKeys.matchKey') return params.arrayMatchKeys?.matchKey ?? fallback ?? [];
			return fallback;
		},
		continueOnFail: () => options.continueOnFail ?? false,
		addExecutionHints: (...newHints: unknown[]) => hints.push(...newHints),
		getNode: () => ({ name: 'Data Diff' }),
	} as unknown as IExecuteFunctions;

	return { fn, hints };
}

describe('DataDiff node execute()', () => {
	it('outputs hasChanges/changeCount/changes for object parameters', async () => {
		const node = new DataDiff();
		const { fn } = createExecuteFunctions(
			[{ json: {} }],
			[{ oldData: { a: 1 }, newData: { a: 2 } }],
		);

		const [output] = await node.execute.call(fn);

		expect(output).toHaveLength(1);
		expect(output[0].json).toEqual({
			hasChanges: true,
			changeCount: 1,
			changes: [{ path: 'a', type: 'modified', oldValue: 1, newValue: 2 }],
		});
	});

	it('parses stringified JSON parameters', async () => {
		const node = new DataDiff();
		const { fn } = createExecuteFunctions(
			[{ json: {} }],
			[{ oldData: '{"a":1}', newData: '{"a":1,"b":2}' }],
		);

		const [output] = await node.execute.call(fn);

		expect(output[0].json).toEqual({
			hasChanges: true,
			changeCount: 1,
			changes: [{ path: 'b', type: 'added', newValue: 2 }],
		});
	});

	it('processes multiple items independently with pairedItem set', async () => {
		const node = new DataDiff();
		const { fn } = createExecuteFunctions(
			[{ json: {} }, { json: {} }],
			[{ oldData: { a: 1 }, newData: { a: 1 } }, { oldData: { a: 1 }, newData: { a: 2 } }],
		);

		const [output] = await node.execute.call(fn);

		expect(output[0].json).toMatchObject({ hasChanges: false, changeCount: 0 });
		expect(output[0].pairedItem).toEqual({ item: 0 });
		expect(output[1].json).toMatchObject({ hasChanges: true, changeCount: 1 });
		expect(output[1].pairedItem).toEqual({ item: 1 });
	});

	it('surfaces duplicate-key fallback as an execution hint, not in the JSON output', async () => {
		const node = new DataDiff();
		const { fn, hints } = createExecuteFunctions(
			[{ json: {} }],
			[
				{
					oldData: { contacts: [{ name: 'Raj', age: 1 }, { name: 'Raj', age: 2 }] },
					newData: { contacts: [{ name: 'Raj', age: 9 }, { name: 'Raj', age: 2 }] },
					arrayMatchKeys: { matchKey: [{ arrayPath: 'contacts', matchKey: 'name' }] },
				},
			],
		);

		const [output] = await node.execute.call(fn);

		expect(hints.length).toBeGreaterThan(0);
		expect(Object.keys(output[0].json)).toEqual(['hasChanges', 'changeCount', 'changes']);
	});

	it('throws a NodeOperationError for invalid JSON when continueOnFail is false', async () => {
		const node = new DataDiff();
		const { fn } = createExecuteFunctions([{ json: {} }], [{ oldData: '{not valid json', newData: {} }]);

		await expect(node.execute.call(fn)).rejects.toThrow();
	});

	it('returns an error item instead of throwing when continueOnFail is true', async () => {
		const node = new DataDiff();
		const { fn } = createExecuteFunctions(
			[{ json: {} }],
			[{ oldData: '{not valid json', newData: {} }],
			{ continueOnFail: true },
		);

		const [output] = await node.execute.call(fn);

		expect(output[0].json).toHaveProperty('error');
	});
});
