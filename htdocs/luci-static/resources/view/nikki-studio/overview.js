'use strict';
'require view';
'require dom';
'require ui';
'require tools.nikkistudio as ns';

/* SPDX-License-Identifier: GPL-3.0-or-later */

function yesno(v, okText, badText, warn) {
	return v ? ns.badge(okText || '正常', 'ok') : ns.badge(badText || '缺失', warn ? 'warn' : 'err');
}

return view.extend({
	load: function() { return ns.load(); },

	render: function(session) {
		var content = E('div', {});
		var self = this;
		function build() { dom.content(content, self.build(session)); }
		session.onChange(build);
		build();
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'Nikki Studio · 概览'),
			E('div', { 'class': 'cbi-map-descr' }, '可视化编辑 Nikki（Mihomo）的节点、策略组、规则与规则集。修改默认写入混入文件 mixin.yaml，订阅更新不会覆盖；保存前会模拟 Nikki 的启动合并流程并用 Mihomo 内核校验，重启失败自动回滚。'),
			ns.renderHeader(session),
			content
		]);
	},

	build: function(session) {
		var st = session.state, n = st.nikki || {}, env = st.env || {}, v = st.versions || {};
		var out = [];
		var problems = [];

		if (!env.release_supported)
			problems.push([ 'warning', '当前系统为 ' + (env.description || env.release || '未知版本') + '，本插件仅针对 OpenWrt 25.12 及以上版本设计与测试。' ]);
		if (!env.merge_logic_ok)
			problems.push([ 'warning', '检测到当前 Nikki 的启动合并逻辑与本插件适配的版本不同，校验结果可能不准确。请将 Nikki 与本插件更新到最新版本。' ]);
		if (n.core_only)
			problems.push([ 'danger', 'Nikki 处于「仅核心」模式：混入设置与透明代理都不会生效。' ]);
		if (!n.mixin_file_content)
			problems.push([ 'danger', [ 'Nikki 未启用「混入文件」，在本插件中对 mixin.yaml 的修改不会生效。 ',
				ns.btn('一键开启', 'cbi-button-positive', function() {
					return ns.callSetMixinFile(true).then(function(r) {
						if (!r.success) return ns.notify('开启失败', 'danger');
						ns.notify('已开启混入文件，重启 Nikki 后生效', 'info');
						return session.reload();
					});
				}) ] ]);
		if (st.luci_rules)
			problems.push([ 'warning', 'Nikki 插件中已开启「混入配置 → 规则」：启动时它会整体覆盖 mixin.yaml 中的「追加规则」(nikki-rules)。建议二选一：关闭 LuCI 规则，或在本插件中只使用「替换订阅的全部规则」。' ]);
		if ((env.conflicts || []).length)
			problems.push([ 'warning', '检测到其他代理插件已启用：' + env.conflicts.join('、') + '，可能与 Nikki 冲突。' ]);
		if (env.dns_redirect)
			problems.push([ 'notice', 'dnsmasq 开启了 DNS 重定向，可能影响 Nikki 的 DNS 劫持。' ]);
		var tools = env.tools || {};
		var missing = Object.keys(tools).filter(function(k) { return !tools[k]; });
		if (missing.length)
			problems.push([ 'danger', '缺少必要组件：' + missing.join('、') + '，校验与保存将无法进行。' ]);

		if (problems.length)
			out.push(E('div', { 'class': 'cbi-section' }, [ E('h3', {}, '需要注意') ].concat(problems.map(function(p) {
				return E('div', { 'class': 'alert-message ' + p[0] }, p[1]);
			}))));

		var src = st.source || {};
		var srcText = src.error ? ('未选择（' + src.error + '）') : ((src.type == 'subscription' ? '订阅：' : '配置文件：') + (src.name || src.id) + (src.exists ? '' : '（文件不存在，请先更新订阅）'));
		var s = session.source || {};
		out.push(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, '运行状态'),
			E('div', { 'class': 'ns-kv' }, [
				E('span', {}, 'Nikki'), E('span', {}, [ st.running ? ns.badge('运行中', 'ok') : ns.badge('未运行', n.enabled ? 'err' : ''), n.enabled ? '' : ns.badge('未启用', 'warn') ]),
				E('span', {}, '代理模式'), E('span', {}, n.proxy_enabled ? ('TCP：' + (n.tcp_mode || '-') + '，UDP：' + (n.udp_mode || '-')) : '透明代理未开启'),
				E('span', {}, '配置来源'), E('span', {}, srcText),
				E('span', {}, '来源内容'), E('span', {}, session.source ? ((s.proxies || []).length + ' 个节点，' + (s.groups || []).length + ' 个策略组，' + (s.rules || []).length + ' 条规则，' + (s.rule_providers || []).length + ' 个规则集' + ((s.proxy_providers || []).length ? '，' + s.proxy_providers.length + ' 个节点订阅(proxy-providers)' : '')) : '-'),
				E('span', {}, '混入文件'), E('span', {}, [ yesno(n.mixin_file_content, '已启用', '未启用'), ' ', (st.targets && st.targets.mixin && st.targets.mixin.exists) ? '/etc/nikki/mixin.yaml' : '（mixin.yaml 尚不存在，保存时自动创建）' ]),
				E('span', {}, '已使用的混入段'), E('span', {}, (st.mixin_sections || []).length ? st.mixin_sections.join('、') : '无'),
				E('span', {}, '版本'), E('span', {}, [ 'nikki ' + (v.nikki || '?'), ' · luci-app-nikki ' + (v['luci-app-nikki'] || '?'), ' · mihomo ' + (v.mihomo || '?'), ' · nikki-studio ' + (v['luci-app-nikki-studio'] || '?') ]),
				E('span', {}, '系统'), E('span', {}, env.description || env.release || '?'),
				E('span', {}, '内核模块'), E('span', {}, Object.keys(env.kmods || {}).map(function(k) { return yesno(env.kmods[k], k, k + ' 缺失', true); })),
				E('span', {}, '外部扩展脚本'), E('span', {}, (env.companion_scripts && env.companion_scripts.length) ? env.companion_scripts.map(function(s) {
					return E('span', { 'class': 'ns-badge ok', 'style': 'margin-right:.5em' }, s.name + ' (' + s.status + ')');
				}) : ns.badge('无扩展脚本', 'info'))
			])
		]));

		var cur = session.target;
		var counts = function(kind) {
			return session.sectionsFor(kind).map(function(k) {
				var it = session.items(k);
				return k + '：' + (Array.isArray(it) ? it.length : Object.keys(it || {}).length);
			}).join('，');
		};
		out.push(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, '当前编辑目标：' + session.targetLabel()),
			cur == 'mixin'
				? E('p', {}, '推荐方式。你在本插件中添加的节点、策略组、规则保存在 /etc/nikki/mixin.yaml，Nikki 启动时与订阅合并：「追加」类内容插在订阅内容前面（优先级更高），「替换」类内容整体替换订阅中的对应部分。订阅更新不会覆盖这些修改。')
				: E('p', {}, '直接修改 /etc/nikki/profiles/ 下的配置文件。请勿用于会被自动更新覆盖的文件。'),
			E('ul', {}, [
				E('li', {}, [ E('a', { 'href': L.url('admin/services/nikki-studio/proxies') }, '节点'), '：' + counts('proxies') ]),
				E('li', {}, [ E('a', { 'href': L.url('admin/services/nikki-studio/groups') }, '策略组'), '：' + counts('groups') ]),
				E('li', {}, [ E('a', { 'href': L.url('admin/services/nikki-studio/rules') }, '规则'), '：' + counts('rules') ]),
				E('li', {}, [ E('a', { 'href': L.url('admin/services/nikki-studio/providers') }, '规则集'), '：' + counts('providers') ])
			]),
			E('p', { 'class': 'ns-help' }, '订阅文件（subscriptions）会被自动更新覆盖，因此不能作为编辑目标；对订阅的修改请写在混入文件里。')
		]));

		out.push(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, '快速上手'),
			E('ol', {}, [
				E('li', {}, '在「节点」页粘贴分享链接（ss/vmess/vless/trojan/hysteria2/tuic）或 WireGuard 配置导入自建节点。'),
				E('li', {}, '在「策略组」页新建分组（例如 🧑‍💻 OpenCode），选择成员节点，或用关键字筛选订阅节点。'),
				E('li', {}, '在「规则」页添加规则，把指定域名分流到你的策略组；可用「规则测试」检查某个域名会命中哪条规则。'),
				E('li', {}, '点击「校验」检查配置；确认无误后「保存并重启」。启动失败会自动回滚，所有版本可在「备份与恢复」中找回。')
			])
		]));
		return out;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
