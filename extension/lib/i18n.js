// extension/lib/i18n.js — chrome.i18n 薄包装。测试环境无 chrome 时回退到 key 本身,
// 让纯函数测试不必 stub 整个 chrome 命名空间。
export function t(key, substitutions) {
	if (typeof chrome !== "undefined" && chrome.i18n) {
		return chrome.i18n.getMessage(key, substitutions) || key;
	}
	return key;
}
