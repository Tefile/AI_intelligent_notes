/**
 * uTools 插件生命周期监听器
 *
 * 在 uTools 环境中监听 onPluginEnter 事件；
 * 在 Electron 桌面应用中，插件生命周期不适用，init() 为空操作。
 * useUtoolsEnterData() 始终返回安全的默认值。
 */

import { ref } from 'vue';

const utoolsEnterEventData = ref({
    code: '',
    type: '',
    payload: '',
    from: '',
    option: ''
})

function initUtoolsListener() {
    // uTools 环境：注册 PluginEnter 回调
    if (typeof window !== 'undefined' && window?.utools?.onPluginEnter) {
        try {
            window.utools.onPluginEnter((data) => {
                const safe = data && typeof data === 'object' ? data : {};
                const {
                    code = '',
                    type = '',
                    payload = '',
                    from = '',
                    option = ''
                } = safe;
                utoolsEnterEventData.value = { code, type, payload, from, option };
            });
        } catch (err) {
            console.warn('初始化 uTools 监听失败：', err);
        }
    }
    // Electron 桌面环境中无 onPluginEnter，跳过
}

export function useUtoolsEnterData() {
    return utoolsEnterEventData
}

export default {
    init: initUtoolsListener
}
