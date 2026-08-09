// Community node packages must not declare npm runtime "dependencies" (see
// @n8n/community-nodes/no-runtime-dependencies): n8n only installs what's in
// "dependencies", and third-party packages can conflict with the host n8n
// instance's own dependency tree. json-diff-ts is therefore a devDependency,
// and this script inlines it into the compiled node file after `tsc` runs,
// so the published package has zero runtime dependencies of its own.
const { buildSync } = require('esbuild');

buildSync({
	entryPoints: ['nodes/DataDiff/DataDiff.node.ts'],
	outfile: 'dist/nodes/DataDiff/DataDiff.node.js',
	bundle: true,
	platform: 'node',
	target: 'node18',
	format: 'cjs',
	external: ['n8n-workflow'],
	// json-diff-ts ships as CommonJS, so esbuild bundles it as an opaque blob
	// it can't tree-shake — dead code paths (e.g. a console.warn() inside a
	// removeKey() helper we never call) end up in the output regardless.
	// n8n's community node scan runs eslint's no-console rule against the
	// shipped file, so strip every console.* call from the bundle outright.
	drop: ['console'],
	allowOverwrite: true,
	logLevel: 'info',
});
