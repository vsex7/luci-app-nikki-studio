# SPDX-License-Identifier: GPL-3.0-or-later

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-nikki-studio
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-3.0-or-later
PKG_MAINTAINER:=nathan

LUCI_TITLE:=Visual editor for Nikki (Mihomo) proxies, groups and rules
LUCI_DESCRIPTION:=Edit Nikki mixin/profile proxies, proxy groups, rules and rule providers with a GUI. \
	Validates by simulating the Nikki start-up merge and Mihomo test, with backups and auto rollback.
LUCI_DEPENDS:=+luci-base +nikki +yq +curl +ucode +ucode-mod-fs +ucode-mod-uci
LUCI_PKGARCH:=all

# Crockford jsmin mishandles some regex literals; ship readable sources.
LUCI_MINIFY_JS:=0

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
sed -i '\#^/etc/nikki-studio/$$#d' /etc/sysupgrade.conf 2>/dev/null
rm -rf /var/run/nikki-studio 2>/dev/null
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
