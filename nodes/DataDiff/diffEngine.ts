import { diff as jsonDiff, Operation } from 'json-diff-ts';
import type { IChange } from 'json-diff-ts';

export type ChangeType = 'modified' | 'added' | 'removed' | 'typeChanged';

export interface ChangeEntry {
	path: string;
	type: ChangeType;
	oldValue?: unknown;
	newValue?: unknown;
}

export interface ArrayMatchKey {
	arrayPath: string;
	matchKey: string;
}

export interface DiffOptions {
	arrayMatchKeys?: ArrayMatchKey[];
	maxDepth?: number;
}

export interface DiffResult {
	hasChanges: boolean;
	changeCount: number;
	changes: ChangeEntry[];
	warnings: string[];
}

export const DEFAULT_MAX_DEPTH = 20;

export function computeDiff(
	oldDataInput: unknown,
	newDataInput: unknown,
	options: DiffOptions = {},
): DiffResult {
	const maxDepth =
		typeof options.maxDepth === 'number' && options.maxDepth > 0
			? Math.floor(options.maxDepth)
			: DEFAULT_MAX_DEPTH;

	const oldData = oldDataInput ?? {};
	const newData = newDataInput ?? {};

	const warnings: string[] = [];
	const embeddedObjKeys: Record<string, string> = {};

	for (const row of options.arrayMatchKeys ?? []) {
		const arrayPath = row?.arrayPath?.trim();
		const matchKey = row?.matchKey?.trim();
		if (!arrayPath || !matchKey) continue;

		if (isMatchKeyUsable(oldData, newData, arrayPath, matchKey, warnings)) {
			embeddedObjKeys[arrayPath] = matchKey;
		}
	}

	const boundaryChanges: ChangeEntry[] = [];
	const { old: cappedOldData, new: cappedNewData } = capDepthPaired(
		oldData,
		newData,
		maxDepth,
		0,
		'',
		boundaryChanges,
	);

	const rawChanges = jsonDiff(cappedOldData, cappedNewData, {
		embeddedObjKeys,
		treatTypeChangeAsReplace: true,
	});

	const changes: ChangeEntry[] = [...boundaryChanges];
	walkChangeList(rawChanges, cappedOldData, cappedNewData, '', changes);

	return {
		hasChanges: changes.length > 0,
		changeCount: changes.length,
		changes,
		warnings,
	};
}

function runtimeType(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

function getProp(node: unknown, key: string | number): unknown {
	if (node === null || typeof node !== 'object') return undefined;
	return (node as Record<string, unknown>)[key as string];
}

function appendKey(prefix: string, key: string | number): string {
	// '$root' is produced by json-diff-ts only when the entire compared value
	// changes to an incompatible type at the top level (no property name to append).
	if (key === '$root') return prefix;
	return prefix ? `${prefix}.${key}` : String(key);
}

function isTypeChangePair(a: IChange, b: IChange | undefined): b is IChange {
	return !!b && a.type === Operation.REMOVE && b.type === Operation.ADD && a.key === b.key;
}

function makeLeafEntry(path: string, change: IChange): ChangeEntry {
	if (change.type === Operation.ADD) {
		return { path, type: 'added', newValue: change.value };
	}
	if (change.type === Operation.REMOVE) {
		return { path, type: 'removed', oldValue: change.value };
	}
	const type: ChangeType =
		runtimeType(change.oldValue) !== runtimeType(change.value) ? 'typeChanged' : 'modified';
	return { path, type, oldValue: change.oldValue, newValue: change.value };
}

function resolveArrayItem(
	oldArr: unknown[],
	newArr: unknown[],
	embeddedKey: string,
	id: string | number,
): { itemOld: unknown; itemNew: unknown } {
	if (embeddedKey === '$index') {
		const index = Number(id);
		return { itemOld: oldArr[index], itemNew: newArr[index] };
	}
	const find = (arr: unknown[]) =>
		arr.find(
			(item) =>
				item !== null &&
				typeof item === 'object' &&
				!Array.isArray(item) &&
				String((item as Record<string, unknown>)[embeddedKey]) === String(id),
		);
	return { itemOld: find(oldArr), itemNew: find(newArr) };
}

function walkChangeList(
	list: IChange[],
	oldNode: unknown,
	newNode: unknown,
	pathPrefix: string,
	out: ChangeEntry[],
): void {
	for (let i = 0; i < list.length; i++) {
		const change = list[i];
		const next = list[i + 1];

		if (isTypeChangePair(change, next)) {
			const path = appendKey(pathPrefix, change.key);
			out.push({ path, type: 'typeChanged', oldValue: change.value, newValue: next.value });
			i++;
			continue;
		}

		if (change.embeddedKey !== undefined) {
			handleArrayChange(change, oldNode, newNode, pathPrefix, out);
			continue;
		}

		if (change.changes) {
			const path = appendKey(pathPrefix, change.key);
			const childOld = getProp(oldNode, change.key);
			const childNew = getProp(newNode, change.key);
			walkChangeList(change.changes, childOld, childNew, path, out);
			continue;
		}

		const path = appendKey(pathPrefix, change.key);
		out.push(makeLeafEntry(path, change));
	}
}

function handleArrayChange(
	change: IChange,
	oldNode: unknown,
	newNode: unknown,
	pathPrefix: string,
	out: ChangeEntry[],
): void {
	const arrayPath = appendKey(pathPrefix, change.key);
	const oldArrRaw = getProp(oldNode, change.key);
	const newArrRaw = getProp(newNode, change.key);
	const oldArr = Array.isArray(oldArrRaw) ? oldArrRaw : [];
	const newArr = Array.isArray(newArrRaw) ? newArrRaw : [];
	const embeddedKey = String(change.embeddedKey);
	const itemChanges = change.changes ?? [];

	for (let i = 0; i < itemChanges.length; i++) {
		const itemChange = itemChanges[i];
		const nextItemChange = itemChanges[i + 1];

		if (isTypeChangePair(itemChange, nextItemChange)) {
			const itemPath = `${arrayPath}[${itemChange.key}]`;
			out.push({
				path: itemPath,
				type: 'typeChanged',
				oldValue: itemChange.value,
				newValue: nextItemChange.value,
			});
			i++;
			continue;
		}

		const itemPath = `${arrayPath}[${itemChange.key}]`;
		const { itemOld, itemNew } = resolveArrayItem(oldArr, newArr, embeddedKey, itemChange.key);

		if (itemChange.changes) {
			walkChangeList(itemChange.changes, itemOld, itemNew, itemPath, out);
		} else {
			out.push(makeLeafEntry(itemPath, itemChange));
		}
	}
}

function getByPath(root: unknown, path: string): unknown {
	return path.split('.').reduce<unknown>((current, segment) => getProp(current, segment), root);
}

function isMatchKeyUsable(
	oldData: unknown,
	newData: unknown,
	arrayPath: string,
	matchKey: string,
	warnings: string[],
): boolean {
	const arrays = [getByPath(oldData, arrayPath), getByPath(newData, arrayPath)].filter(
		(value): value is unknown[] => Array.isArray(value),
	);

	if (arrays.length === 0) return true;

	for (const arr of arrays) {
		const seen = new Set<string>();
		for (const item of arr) {
			if (item === null || typeof item !== 'object' || Array.isArray(item)) {
				warnings.push(
					`Array match key ignored for "${arrayPath}": array contains non-object item(s), so the key "${matchKey}" cannot be used. Falling back to index-based comparison for this array.`,
				);
				return false;
			}
			const record = item as Record<string, unknown>;
			if (!(matchKey in record)) {
				warnings.push(
					`Array match key ignored for "${arrayPath}": some item(s) are missing the "${matchKey}" field. Falling back to index-based comparison for this array.`,
				);
				return false;
			}
			const keyValue = String(record[matchKey]);
			if (seen.has(keyValue)) {
				warnings.push(
					`Array match key ignored for "${arrayPath}": duplicate value "${keyValue}" found for key "${matchKey}". Falling back to index-based comparison for this array.`,
				);
				return false;
			}
			seen.add(keyValue);
		}
	}

	return true;
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
	return value !== null && typeof value === 'object';
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (!isContainer(a) || !isContainer(b)) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;

	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((item, index) => deepEqual(item, b[index]));
	}

	const aRecord = a as Record<string, unknown>;
	const bRecord = b as Record<string, unknown>;
	const aKeys = Object.keys(aRecord);
	const bKeys = Object.keys(bRecord);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every((key) => key in bRecord && deepEqual(aRecord[key], bRecord[key]));
}

// A stand-in written to both sides once a subtree has been resolved (either
// found equal, or recorded as a boundary ChangeEntry below), so json-diff-ts
// sees identical values there and does not also try to diff into it itself.
const BOUNDARY_PLACEHOLDER = {};

// Walks oldValue/newValue together. Once a node's depth reaches maxDepth, the
// two subtrees at that point are compared as opaque units via deep equality
// rather than recursed into further: if they differ, a single 'modified'
// ChangeEntry is recorded (with the full subtrees as oldValue/newValue) so the
// difference is never silently lost, it's just not expanded field-by-field.
function capDepthPaired(
	oldValue: unknown,
	newValue: unknown,
	maxDepth: number,
	depth: number,
	path: string,
	boundaryChanges: ChangeEntry[],
): { old: unknown; new: unknown } {
	const oldIsContainer = isContainer(oldValue);
	const newIsContainer = isContainer(newValue);

	if (depth >= maxDepth && (oldIsContainer || newIsContainer)) {
		if (!deepEqual(oldValue, newValue)) {
			boundaryChanges.push({ path, type: 'modified', oldValue, newValue });
		}
		return { old: BOUNDARY_PLACEHOLDER, new: BOUNDARY_PLACEHOLDER };
	}

	if (oldIsContainer && newIsContainer && Array.isArray(oldValue) === Array.isArray(newValue)) {
		if (Array.isArray(oldValue) && Array.isArray(newValue)) {
			const cappedOld: unknown[] = [];
			const cappedNew: unknown[] = [];
			// Only indices present on both sides are paired and depth-capped; an
			// index present on just one side is a plain add/remove, not a
			// truncation boundary, so it's passed through with its real value
			// and left for json-diff-ts to report normally (no capping needed,
			// since a single add/remove is already reported as one whole unit).
			const pairedLength = Math.min(oldValue.length, newValue.length);
			for (let i = 0; i < pairedLength; i++) {
				const { old: o, new: n } = capDepthPaired(
					oldValue[i],
					newValue[i],
					maxDepth,
					depth + 1,
					`${path}[${i}]`,
					boundaryChanges,
				);
				cappedOld[i] = o;
				cappedNew[i] = n;
			}
			for (let i = pairedLength; i < oldValue.length; i++) cappedOld[i] = oldValue[i];
			for (let i = pairedLength; i < newValue.length; i++) cappedNew[i] = newValue[i];
			return { old: cappedOld, new: cappedNew };
		}

		const oldRecord = oldValue as Record<string, unknown>;
		const newRecord = newValue as Record<string, unknown>;
		const cappedOld: Record<string, unknown> = {};
		const cappedNew: Record<string, unknown> = {};
		for (const key of new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)])) {
			const hasOld = key in oldRecord;
			const hasNew = key in newRecord;
			if (hasOld && hasNew) {
				const keyPath = path ? `${path}.${key}` : key;
				const { old: o, new: n } = capDepthPaired(
					oldRecord[key],
					newRecord[key],
					maxDepth,
					depth + 1,
					keyPath,
					boundaryChanges,
				);
				cappedOld[key] = o;
				cappedNew[key] = n;
			} else if (hasOld) {
				cappedOld[key] = oldRecord[key];
			} else {
				cappedNew[key] = newRecord[key];
			}
		}
		return { old: cappedOld, new: cappedNew };
	}

	return { old: oldValue, new: newValue };
}
