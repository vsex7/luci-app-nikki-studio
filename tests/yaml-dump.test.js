// dumpYaml output must parse back to identical data with yq
const assert = require('assert'), { execFileSync } = require('child_process');
const P = require('./load.js')(__dirname + '/../htdocs/luci-static/resources/tools/nikkistudio_parse.js');
const samples = [
	{ a: 'yes', b: 'no', c: 'null', d: '~', e: '0x1F', f: '1e5', g: '.inf', h: '-1', i: '- x', j: 'a #b', k: 'a: b', l: '', m: ' lead', n: 'trail ', o: '@at', p: '`tick', q: '"q"', r: "'s'", s: '[x]', t: '{x}', u: '!tag', v: '&anc', w: '*ali', x: '%p', y: '|', z: '>' },
	{ '🚀 key': 1, 'on': true, 'with space': [ 1, 'two', { three: [ 3 ] } ], nested: { deep: { deeper: [] } }, empty: {}, nul: null, f: 1.5, neg: -3 },
	P.parseShareLink('vless://u@a.com:443?security=reality&pbk=PK&sid=ab&sni=www.apple.com&fp=chrome&type=ws&path=%2Fp%3Fed%3D2048&host=h.com#%F0%9F%87%BA%F0%9F%87%B8%20US'),
	{ pw: 'p@ss: w#rd\n2', tab: 'a\tb', uni: '中文：冒号', emoji: '🧑‍💻 OpenCode' }
];
for (const s of samples) {
	const y = P.dumpYaml(s);
	const back = JSON.parse(execFileSync('yq', [ '-o', 'json', '.', '-' ], { input: y }).toString());
	assert.deepStrictEqual(back, s, 'mismatch for\n' + y);
}
console.log('yaml dump tests passed: ' + samples.length);
