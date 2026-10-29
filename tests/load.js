// Load a LuCI module in node with stubbed requires.
const fs = require('fs');
module.exports = function(path, deps) {
	const src = fs.readFileSync(path, 'utf8');
	const names = [], vals = [];
	src.replace(/^'require ([^ ';]+)(?: as ([A-Za-z_]\w*))?';$/mg, (m, mod, as) => {
		const n = as || mod.split(/[.\/]/).pop();
		names.push(n); vals.push((deps || {})[mod] || (mod == 'baseclass' ? { extend: (o) => o } : {}));
	});
	return new Function(...names, src).apply(null, vals);
};
