'use strict';
'require view';
'require dom';
'require ui';
'require tools.nikkistudio as ns';

/* SPDX-License-Identifier: GPL-3.0-or-later */

var KNOWN_FIELDS = [ 'type', 'path', 'url', 'interval', 'health-check', 'proxy', 'header' ];

return view.extend({
	load: function() { return ns.load(); },

	render: function(session) {
		this.session = session;
		this.content = E('div', {});
		var self = this;
		session.onChange(function() { self.refresh(); });
		this.refresh();
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'Nikki Studio · 节点池（Proxy Providers）'),
			E('div', { 'class': 'cbi-map-descr' }, '节点池（proxy-providers）用于从本地文件或网络 URL 动态加载外部机场订阅节点，并在策略组中通过 use: [提供者名称] 引用。实现节点与核心分流配置彻底解耦。'),
			ns.renderHeader(session),
			this.content
		]);
	},

	refresh: function() { dom.content(this.content, this.build()); },
	sec: function() { return 'proxy-providers'; },

	build: function() {
		var session = this.session;
		var map = session.map(this.sec()) || {};
		var names = Object.keys(map).sort();
		var self = this;

		var rows = names.map(function(name) {
			var p = map[name] || {};
			var hc = p['health-check'] || {};
			var hcText = hc.enable ? ('URL 探测 (' + (hc.interval || 300) + 's)') : '未开启健康探测';
			var targetText = p.type == 'file' ? (p.path || '-') : (p.url || '-');

			return E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td', 'style': 'font-weight:bold' }, name),
				E('div', { 'class': 'td' }, ns.badge(p.type || 'file', 'info')),
				E('div', { 'class': 'td', 'style': 'word-break:break-all' }, targetText),
				E('div', { 'class': 'td' }, ns.badge(hcText, hc.enable ? 'ok' : '')),
				E('div', { 'class': 'td ns-actions' }, [
					ns.btn('编辑', 'cbi-button-action', function() { self.edit(name, p); }),
					ns.btn('删除', 'cbi-button-negative', function() {
						session.deleteMapEntry(self.sec(), name);
					})
				])
			]);
		});

		var table = E('div', { 'class': 'table ns-list' }, [
			E('div', { 'class': 'tr table-titles' }, [
				E('div', { 'class': 'th', 'style': 'width:15%' }, '名称'),
				E('div', { 'class': 'th', 'style': 'width:10%' }, '类型'),
				E('div', { 'class': 'th', 'style': 'width:45%' }, '路径 / URL'),
				E('div', { 'class': 'th', 'style': 'width:18%' }, '健康检查'),
				E('div', { 'class': 'th ns-actions', 'style': 'width:12%' }, '操作')
			])
		].concat(rows.length ? rows : [
			E('div', { 'class': 'tr' }, [ E('div', { 'class': 'td', 'colspan': 5, 'style': 'text-align:center;color:#888;padding:1.5em' }, '暂无外部节点池配置。点击下方「添加节点池」挂载机场订阅。') ])
		]));

		return E('div', {}, [
			E('div', { 'class': 'ns-bar' }, [
				E('span', { 'class': 'ns-badge info' }, '共 ' + names.length + ' 个节点池'),
				E('div', { 'class': 'ns-grow' }),
				ns.btn('添加节点池', 'cbi-button-positive', function() { self.edit(null, {}); })
			]),
			table
		]);
	},

	edit: function(oldName, p) {
		var isNew = !oldName;
		p = p || {};
		var self = this;
		var session = this.session;

		var fName = ns.input(oldName || '', { placeholder: '例如：xsus 或 cucloud' });
		if (!isNew) fName.disabled = true;

		var fType = ns.select(p.type || 'file', [ [ 'file', '本地文件（file）' ], [ 'http', '网络在线订阅（http）' ] ]);
		var fPath = ns.input(p.path || '/etc/nikki/subscriptions/', { placeholder: '/etc/nikki/subscriptions/xxx.yaml' });
		var fUrl = ns.input(p.url || '', { placeholder: 'https://airport.com/api/v1/client/subscribe?token=...' });
		var fInterval = ns.input(p.interval || 86400, { type: 'number' });
		
		var hc = p['health-check'] || {};
		var fHcEnable = ns.checkbox(hc.enable !== false, '开启健康检查');
		var fHcUrl = ns.input(hc.url || 'https://www.gstatic.com/generate_204', { placeholder: 'https://www.gstatic.com/generate_204' });
		var fHcInterval = ns.input(hc.interval || 300, { type: 'number', placeholder: '300' });

		var rowPath = E('div', { 'class': 'ns-row' }, [ E('label', {}, '文件路径'), E('div', { 'class': 'ns-ctl' }, fPath) ]);
		var rowUrl = E('div', { 'class': 'ns-row' }, [ E('label', {}, '订阅 URL'), E('div', { 'class': 'ns-ctl' }, fUrl) ]);
		var rowInterval = E('div', { 'class': 'ns-row' }, [ E('label', {}, '更新间隔(秒)'), E('div', { 'class': 'ns-ctl' }, fInterval) ]);

		function updateType() {
			var isHttp = fType.value == 'http';
			rowPath.style.display = isHttp ? 'none' : '';
			rowUrl.style.display = isHttp ? '' : 'none';
			rowInterval.style.display = isHttp ? '' : 'none';
		}
		fType.addEventListener('change', updateType);
		updateType();

		var body = E('div', { 'class': 'ns-form' }, [
			E('div', { 'class': 'ns-row' }, [ E('label', {}, '节点池标识'), E('div', { 'class': 'ns-ctl' }, fName) ]),
			E('div', { 'class': 'ns-row' }, [ E('label', {}, '加载类型'), E('div', { 'class': 'ns-ctl' }, fType) ]),
			rowPath, rowUrl, rowInterval,
			E('h4', { 'style': 'margin-top:1em;border-bottom:1px solid #8883;padding-bottom:.3em' }, '健康检查（Health Check）'),
			E('div', { 'class': 'ns-row' }, [ E('label', {}, '状态'), E('div', { 'class': 'ns-ctl' }, fHcEnable) ]),
			E('div', { 'class': 'ns-row' }, [ E('label', {}, '测速 URL'), E('div', { 'class': 'ns-ctl' }, fHcUrl) ]),
			E('div', { 'class': 'ns-row' }, [ E('label', {}, '测速间隔(秒)'), E('div', { 'class': 'ns-ctl' }, fHcInterval) ])
		]);

		ui.showModal(isNew ? '添加节点池' : '编辑节点池', [
			body,
			E('div', { 'class': 'right', 'style': 'margin-top:1em' }, [
				ns.btn('取消', 'cbi-button', function() { ui.hideModal(); }),
				' ',
				ns.btn('确定', 'cbi-button-positive', function() {
					var name = fName.value.trim();
					if (!name) return ns.notify('节点池标识不能为空', 'danger');
					
					var out = Object.assign({}, p);
					out.type = fType.value;
					if (out.type == 'file') {
						out.path = fPath.value.trim();
						delete out.url;
						delete out.interval;
					} else {
						out.url = fUrl.value.trim();
						out.interval = parseInt(fInterval.value) || 86400;
						delete out.path;
					}

					out['health-check'] = {
						enable: fHcEnable.querySelector('input').checked,
						url: fHcUrl.value.trim(),
						interval: parseInt(fHcInterval.value) || 300
					};

					session.setMapEntry(self.sec(), name, out);
					ui.hideModal();
				})
			])
		]);
	}
});
