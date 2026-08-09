import { computeDiff } from '../nodes/DataDiff/diffEngine';

describe('computeDiff - flat objects', () => {
	it('reports modified, added and removed top-level fields', () => {
		const result = computeDiff({ a: 1, b: 2, c: 3 }, { a: 1, b: 20, d: 4 });

		expect(result.hasChanges).toBe(true);
		expect(result.changeCount).toBe(3);
		expect(result.changes).toContainEqual({ path: 'b', type: 'modified', oldValue: 2, newValue: 20 });
		expect(result.changes).toContainEqual({ path: 'd', type: 'added', newValue: 4 });
		expect(result.changes).toContainEqual({ path: 'c', type: 'removed', oldValue: 3 });
	});

	it('omits oldValue for added entries and newValue for removed entries', () => {
		const result = computeDiff({ removedField: 'gone' }, { addedField: 'new' });

		const added = result.changes.find((c) => c.type === 'added')!;
		const removed = result.changes.find((c) => c.type === 'removed')!;

		expect('oldValue' in added).toBe(false);
		expect('newValue' in removed).toBe(false);
	});

	it('returns no changes for identical inputs', () => {
		const data = { a: 1, b: { c: 2 }, d: [1, 2, 3] };
		const result = computeDiff(data, JSON.parse(JSON.stringify(data)));

		expect(result).toEqual({ hasChanges: false, changeCount: 0, changes: [], warnings: [] });
	});

	it('returns no changes for two empty objects', () => {
		const result = computeDiff({}, {});
		expect(result).toEqual({ hasChanges: false, changeCount: 0, changes: [], warnings: [] });
	});
});

describe('computeDiff - null/undefined inputs', () => {
	it('treats a null Old Data as an empty object (everything reported as added)', () => {
		const result = computeDiff(null, { a: 1, b: 2 });

		expect(result.hasChanges).toBe(true);
		expect(result.changeCount).toBe(2);
		expect(result.changes).toContainEqual({ path: 'a', type: 'added', newValue: 1 });
		expect(result.changes).toContainEqual({ path: 'b', type: 'added', newValue: 2 });
	});

	it('treats an undefined New Data as an empty object (everything reported as removed)', () => {
		const result = computeDiff({ a: 1 }, undefined);

		expect(result.changes).toContainEqual({ path: 'a', type: 'removed', oldValue: 1 });
	});

	it('reports no changes when both sides are null', () => {
		const result = computeDiff(null, null);
		expect(result).toEqual({ hasChanges: false, changeCount: 0, changes: [], warnings: [] });
	});
});

describe('computeDiff - nested objects', () => {
	it('produces dot-notation paths at arbitrary depth', () => {
		const result = computeDiff({ a: { b: { c: { d: 1 } } } }, { a: { b: { c: { d: 2 } } } });

		expect(result.changeCount).toBe(1);
		expect(result.changes[0]).toEqual({ path: 'a.b.c.d', type: 'modified', oldValue: 1, newValue: 2 });
	});

	it('supports mixed add/remove/modify across nested levels', () => {
		const oldData = { address: { city: 'Pune', pincode: '411001', geo: { lat: 1 } } };
		const newData = { address: { city: 'Mumbai', geo: { lat: 1, lng: 2 } } };

		const result = computeDiff(oldData, newData);

		expect(result.changes).toContainEqual({
			path: 'address.city',
			type: 'modified',
			oldValue: 'Pune',
			newValue: 'Mumbai',
		});
		expect(result.changes).toContainEqual({ path: 'address.pincode', type: 'removed', oldValue: '411001' });
		expect(result.changes).toContainEqual({ path: 'address.geo.lng', type: 'added', newValue: 2 });
	});
});

describe('computeDiff - arrays of objects without a match key', () => {
	it('compares by index using arrayName[index].field paths', () => {
		const oldData = { items: [{ id: 1, val: 'x' }, { id: 2, val: 'y' }] };
		const newData = { items: [{ id: 1, val: 'x' }, { id: 2, val: 'z' }] };

		const result = computeDiff(oldData, newData);

		expect(result.changeCount).toBe(1);
		expect(result.changes[0]).toEqual({ path: 'items[1].val', type: 'modified', oldValue: 'y', newValue: 'z' });
	});

	it('reports index-based add/remove when array length changes', () => {
		const result = computeDiff({ items: ['a', 'b', 'c'] }, { items: ['a', 'b'] });

		expect(result.changes).toContainEqual({ path: 'items[2]', type: 'removed', oldValue: 'c' });
	});
});

describe('computeDiff - arrays of objects with a match key', () => {
	it('matches items by key regardless of position, reporting only the changed fields', () => {
		const oldData = {
			contacts: [
				{ name: 'Amit', phone: '111' },
				{ name: 'Priya', phone: '222' },
			],
		};
		const newData = {
			contacts: [
				{ name: 'Priya', phone: '222' },
				{ name: 'Amit', phone: '999' },
			],
		};

		const result = computeDiff(oldData, newData, {
			arrayMatchKeys: [{ arrayPath: 'contacts', matchKey: 'name' }],
		});

		expect(result.changeCount).toBe(1);
		expect(result.changes[0]).toEqual({
			path: 'contacts[Amit].phone',
			type: 'modified',
			oldValue: '111',
			newValue: '999',
		});
		expect(result.warnings).toEqual([]);
	});

	it('reports a whole item as added/removed when its key is not matched on the other side', () => {
		const oldData = { contacts: [{ name: 'Amit', phone: '111' }] };
		const newData = {
			contacts: [
				{ name: 'Amit', phone: '111' },
				{ name: 'Priya', phone: '222' },
			],
		};

		const result = computeDiff(oldData, newData, {
			arrayMatchKeys: [{ arrayPath: 'contacts', matchKey: 'name' }],
		});

		expect(result.changeCount).toBe(1);
		expect(result.changes[0]).toEqual({
			path: 'contacts[Priya]',
			type: 'added',
			newValue: { name: 'Priya', phone: '222' },
		});
	});

	it('supports match keys on arrays nested under an object path', () => {
		const oldData = { address: { contacts: [{ name: 'Amit', phone: '111' }] } };
		const newData = { address: { contacts: [{ name: 'Amit', phone: '999' }] } };

		const result = computeDiff(oldData, newData, {
			arrayMatchKeys: [{ arrayPath: 'address.contacts', matchKey: 'name' }],
		});

		expect(result.changes[0].path).toBe('address.contacts[Amit].phone');
	});
});

describe('computeDiff - arrays of primitive values', () => {
	it('compares primitive arrays by index by default (documented library behavior)', () => {
		const result = computeDiff({ colors: ['red', 'blue'] }, { colors: ['blue', 'green'] });

		expect(result.changeCount).toBe(2);
		expect(result.changes).toContainEqual({
			path: 'colors[0]',
			type: 'modified',
			oldValue: 'red',
			newValue: 'blue',
		});
		expect(result.changes).toContainEqual({
			path: 'colors[1]',
			type: 'modified',
			oldValue: 'blue',
			newValue: 'green',
		});
	});
});

describe('computeDiff - duplicate/missing match keys fall back safely', () => {
	it('falls back to index-based comparison and warns when key values are duplicated', () => {
		const oldData = { contacts: [{ name: 'Raj', age: 20 }, { name: 'Raj', age: 25 }] };
		const newData = { contacts: [{ name: 'Raj', age: 21 }, { name: 'Raj', age: 25 }] };

		const result = computeDiff(oldData, newData, {
			arrayMatchKeys: [{ arrayPath: 'contacts', matchKey: 'name' }],
		});

		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0]).toMatch(/duplicate/i);
		expect(result.changeCount).toBe(1);
		expect(result.changes[0]).toEqual({
			path: 'contacts[0].age',
			type: 'modified',
			oldValue: 20,
			newValue: 21,
		});
	});

	it('falls back to index-based comparison and warns when the key field is missing on some items', () => {
		const oldData = { contacts: [{ name: 'A', age: 1 }, { age: 2 }] };
		const newData = { contacts: [{ name: 'A', age: 1 }, { age: 5 }] };

		const result = computeDiff(oldData, newData, {
			arrayMatchKeys: [{ arrayPath: 'contacts', matchKey: 'name' }],
		});

		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0]).toMatch(/missing/i);
		expect(result.changes).toContainEqual({
			path: 'contacts[1].age',
			type: 'modified',
			oldValue: 2,
			newValue: 5,
		});
	});

	it('does not crash on duplicate keys and still produces a result', () => {
		const oldData = { contacts: [{ name: 'Raj' }, { name: 'Raj' }, { name: 'Raj' }] };
		const newData = { contacts: [{ name: 'Raj' }, { name: 'Raj' }, { name: 'Raj', extra: true }] };

		expect(() =>
			computeDiff(oldData, newData, { arrayMatchKeys: [{ arrayPath: 'contacts', matchKey: 'name' }] }),
		).not.toThrow();
	});
});

describe('computeDiff - type changes', () => {
	it('flags a top-level type change distinctly from a value change', () => {
		const result = computeDiff({ count: 1 }, { count: '1' });

		expect(result.changes[0]).toEqual({ path: 'count', type: 'typeChanged', oldValue: 1, newValue: '1' });
	});

	it('flags a type change at arbitrary nesting depth', () => {
		const result = computeDiff({ a: { b: { c: 5 } } }, { a: { b: { c: '5' } } });

		expect(result.changes[0]).toEqual({ path: 'a.b.c', type: 'typeChanged', oldValue: 5, newValue: '5' });
	});

	it('flags a type change inside a matched array item', () => {
		const oldData = { contacts: [{ name: 'Amit', age: 30 }] };
		const newData = { contacts: [{ name: 'Amit', age: '30' }] };

		const result = computeDiff(oldData, newData, {
			arrayMatchKeys: [{ arrayPath: 'contacts', matchKey: 'name' }],
		});

		expect(result.changes[0]).toEqual({
			path: 'contacts[Amit].age',
			type: 'typeChanged',
			oldValue: 30,
			newValue: '30',
		});
	});

	it('does not confuse a type change with modified', () => {
		const result = computeDiff({ a: 1, b: 'x' }, { a: 2, b: 5 });

		const modified = result.changes.find((c) => c.path === 'a')!;
		const typeChanged = result.changes.find((c) => c.path === 'b')!;
		expect(modified.type).toBe('modified');
		expect(typeChanged.type).toBe('typeChanged');
	});
});

describe('computeDiff - max depth', () => {
	it('stops expanding field-by-field beyond maxDepth, reporting one change at the boundary path instead', () => {
		const oldData = { a: { b: { c: { d: 1 } } } };
		const newData = { a: { b: { c: { d: 2 } } } };

		const shallow = computeDiff(oldData, newData, { maxDepth: 2 });
		const deep = computeDiff(oldData, newData, { maxDepth: 20 });

		expect(shallow.changeCount).toBe(1);
		expect(shallow.changes[0].path).toBe('a.b');
		expect(deep.changes[0].path).toBe('a.b.c.d');
	});

	it('still reports a difference that only exists beyond maxDepth, instead of silently dropping it', () => {
		const oldData = { a: { b: { c: { d: 1, e: 'x' } } } };
		const newData = { a: { b: { c: { d: 1, e: 'y' } } } };

		const result = computeDiff(oldData, newData, { maxDepth: 3 });

		expect(result.hasChanges).toBe(true);
		expect(result.changeCount).toBe(1);
		expect(result.changes[0]).toEqual({
			path: 'a.b.c',
			type: 'modified',
			oldValue: { d: 1, e: 'x' },
			newValue: { d: 1, e: 'y' },
		});
	});

	it('reports no changes when content beyond maxDepth is identical, down to array contents', () => {
		const oldData = { a: { b: { c: { d: 1, e: [1, 2, 3] } } } };
		const newData = { a: { b: { c: { d: 1, e: [1, 2, 3] } } } };

		const result = computeDiff(oldData, newData, { maxDepth: 2 });

		expect(result).toEqual({ hasChanges: false, changeCount: 0, changes: [], warnings: [] });
	});

	it('does not double-report a deep field that is genuinely added, once as a boundary change and again as an add', () => {
		const oldData = { a: { b: 1 } };
		const newData = { a: { b: 1, c: { d: { e: 1 } } } };

		const result = computeDiff(oldData, newData, { maxDepth: 2 });

		expect(result.changeCount).toBe(1);
		expect(result.changes[0]).toEqual({ path: 'a.c', type: 'added', newValue: { d: { e: 1 } } });
	});
});

describe('computeDiff - large object performance sanity', () => {
	it('handles an object with 100+ fields correctly and quickly', () => {
		const oldData: Record<string, number> = {};
		const newData: Record<string, number> = {};
		for (let i = 0; i < 150; i++) {
			oldData[`field${i}`] = i;
			newData[`field${i}`] = i;
		}
		// Modify a few, remove one, add one
		newData.field10 = 999;
		newData.field20 = 999;
		delete newData.field5;
		newData.field150 = 1;

		const start = Date.now();
		const result = computeDiff(oldData, newData);
		const elapsedMs = Date.now() - start;

		expect(result.changeCount).toBe(4);
		expect(elapsedMs).toBeLessThan(1000);
	});
});
