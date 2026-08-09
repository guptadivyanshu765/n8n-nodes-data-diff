import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError, jsonParse } from 'n8n-workflow';

import type { ArrayMatchKey } from './diffEngine';
import { DEFAULT_MAX_DEPTH, computeDiff } from './diffEngine';

function getJsonParam(this: IExecuteFunctions, parameterName: string, itemIndex: number): unknown {
	const rawValue = this.getNodeParameter(parameterName, itemIndex, {});

	if (typeof rawValue !== 'string') return rawValue;
	if (rawValue.trim() === '') return {};

	return jsonParse(rawValue, {
		errorMessage: `${this.getNode().name}: "${parameterName}" does not contain valid JSON`,
	});
}

export class DataDiff implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Data Diff',
		name: 'dataDiff',
		icon: { light: 'file:dataDiff.svg', dark: 'file:dataDiff.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: 'Compare two JSON objects and see exactly what changed',
		description: 'Compare two JSON objects and see exactly what changed',
		defaults: {
			name: 'Data Diff',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Old Data',
				name: 'oldData',
				type: 'json',
				default: '{}',
				required: true,
				description: 'The baseline/previous version of the data to compare',
			},
			{
				displayName: 'New Data',
				name: 'newData',
				type: 'json',
				default: '{}',
				required: true,
				description: 'The updated/current version of the data to compare',
			},
			{
				displayName: 'Array Match Keys',
				name: 'arrayMatchKeys',
				type: 'fixedCollection',
				placeholder: 'Add Array Match Key',
				default: {},
				typeOptions: {
					multipleValues: true,
				},
				description:
					'Specify which property identifies each item for a given array field, so items are matched by that key instead of by position. Arrays left unconfigured here are compared by index.',
				options: [
					{
						displayName: 'Match Key',
						name: 'matchKey',
						values: [
							{
								displayName: 'Array Path',
								name: 'arrayPath',
								type: 'string',
								default: '',
								placeholder: 'e.g. contacts or address.contacts',
								description: 'Dot-notation path to the array field, relative to the root of the data',
							},
							{
								displayName: 'Match Key',
								name: 'matchKey',
								type: 'string',
								default: '',
								placeholder: 'e.g. ID or name',
								description: 'Property that uniquely identifies each item in that array',
							},
						],
					},
				],
			},
			{
				displayName: 'Max Depth',
				name: 'maxDepth',
				type: 'number',
				default: DEFAULT_MAX_DEPTH,
				typeOptions: {
					minValue: 1,
				},
				description: 'Maximum levels of nested objects/arrays to compare. Deeper content is not expanded, to avoid runaway recursion and unreadable output on malformed input.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const oldData = getJsonParam.call(this, 'oldData', itemIndex);
				const newData = getJsonParam.call(this, 'newData', itemIndex);
				const maxDepth = this.getNodeParameter('maxDepth', itemIndex, DEFAULT_MAX_DEPTH) as number;
				const arrayMatchKeys = this.getNodeParameter(
					'arrayMatchKeys.matchKey',
					itemIndex,
					[],
				) as ArrayMatchKey[];

				const result = computeDiff(oldData, newData, { arrayMatchKeys, maxDepth });

				for (const warning of result.warnings) {
					this.addExecutionHints({ message: warning, type: 'warning', location: 'outputPane' });
				}

				returnData.push({
					json: {
						hasChanges: result.hasChanges,
						changeCount: result.changeCount,
						changes: result.changes,
					} as unknown as IDataObject,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
