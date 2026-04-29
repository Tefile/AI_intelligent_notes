<template>
  <n-flex
    vertical
    align="center"
    :class="['settings-page', 'settings-page--config', { 'is-dark': theme === 'dark' }]"
    style="max-width: 1000px; margin: 0 auto;"
  >
    <n-card hoverable class="settings-hero-card" style="width: 100%">
      <n-flex justify="space-between" align="center" wrap :size="12">
        <n-flex vertical :size="4">
          <n-text strong style="font-size: 18px;">全局配置</n-text>
          <n-text depth="3" style="font-size: 12px;">
            统一管理主题、数据目录、默认提示词、上下文窗口、云同步和全局配置密码。
          </n-text>
        </n-flex>
        <n-tag :type="hasConfigPassword ? 'warning' : 'success'" bordered>
          {{ hasConfigPassword ? '已启用全局配置密码' : '未设置全局配置密码' }}
        </n-tag>
      </n-flex>
    </n-card>

    <n-card v-if="!configAccessReady" hoverable style="width: 100%; margin-top: 12px;">
      <n-flex vertical :size="10" align="center" style="padding: 24px 8px;">
        <n-text strong>正在验证配置页访问状态</n-text>
        <n-text depth="3">请稍候...</n-text>
      </n-flex>
    </n-card>

    <n-card v-else-if="!configPageUnlocked" hoverable class="config-lock-card" style="width: 100%; margin-top: 12px;">
      <n-flex vertical :size="14" style="max-width: 460px; margin: 0 auto; padding: 12px 0;">
        <n-text strong style="font-size: 18px;">全局配置已加锁</n-text>
        <n-text depth="3">
          已设置全局配置密码。输入密码后才能进入该页面。
        </n-text>
        <n-input
          v-model:value="pageUnlockPassword"
          type="password"
          show-password-toggle
          placeholder="输入全局配置密码"
          @keydown.enter.prevent="submitPageUnlock"
        />
        <n-flex justify="space-between" align="center" wrap :size="12">
          <n-button
            secondary
            :disabled="!hasRecoveryQuestion"
            @click="openSecurityResetModal"
          >
            安全问题重置
          </n-button>
          <n-button type="primary" :loading="pageUnlockLoading" @click="submitPageUnlock">
            进入配置页
          </n-button>
        </n-flex>
        <n-text v-if="hasRecoveryQuestion" depth="3" style="font-size: 12px;">
          忘记密码时可通过安全问题重置，不需要旧密码。
        </n-text>
      </n-flex>
    </n-card>

    <n-flex v-else vertical :size="16" style="width: 100%; margin-top: 12px;">
      <n-card hoverable>
        <n-flex justify="space-between" align="center" wrap :size="12">
          <n-flex vertical :size="6" style="min-width: 240px;">
            <n-text strong>主题</n-text>
            <n-text depth="3">{{ theme === 'dark' ? '当前为深色主题' : '当前为浅色主题' }}</n-text>
          </n-flex>
          <n-button @click="handleToggleTheme">切换主题</n-button>
        </n-flex>
      </n-card>

      <n-card hoverable>
        <n-flex justify="space-between" align="center" wrap :size="12">
          <n-flex vertical :size="6" style="min-width: 280px;">
            <n-text strong>数据存储根目录</n-text>
            <n-text depth="3" style="word-break: break-all;">
              {{ dataStorageRootText }}
            </n-text>
          </n-flex>
          <n-flex :size="10" wrap>
            <n-button @click="handlePickDataStorageRoot">选择目录</n-button>
            <n-button secondary @click="handleResetDataStorageRoot">恢复默认</n-button>
          </n-flex>
        </n-flex>
      </n-card>

      <n-card hoverable>
        <n-flex justify="space-between" align="center" wrap :size="12">
          <n-flex vertical :size="6" style="min-width: 280px;">
            <n-text strong>Notebook Runtime</n-text>
            <n-text depth="3">{{ notebookRuntimeSummary }}</n-text>
            <n-tag :type="notebookLspStatus.type" bordered style="width: fit-content;">
              {{ notebookLspStatus.label }}
            </n-tag>
          </n-flex>
          <n-flex :size="10" wrap>
            <n-button secondary @click="refreshNotebookPythonDetection" :loading="notebookRuntimeDetecting">重新检测</n-button>
            <n-button @click="openNotebookRuntimeModal">编辑配置</n-button>
          </n-flex>
        </n-flex>
      </n-card>

      <n-card hoverable>
        <n-flex vertical :size="12">
          <n-flex justify="space-between" align="center" wrap :size="12">
            <n-flex vertical :size="6" style="min-width: 280px;">
              <n-text strong>联网搜索代理</n-text>
              <n-text depth="3">{{ webSearchProxySummary }}</n-text>
              <n-text depth="3" style="font-size: 12px;">
                只保存在当前电脑本地，不参与云同步；留空表示直连。证书兜底只在证书链异常时重试。
              </n-text>
            </n-flex>
            <n-button type="primary" :loading="webSearchConfigSaving" @click="saveWebSearchConfig">保存联网设置</n-button>
          </n-flex>
          <n-input
            v-model:value="webSearchConfigDraft.proxyUrl"
            placeholder="例如：http://127.0.0.1:7890"
            clearable
          />
          <n-select
            v-model:value="webSearchConfigDraft.searchApiProvider"
            :options="webSearchApiProviderOptions"
          />
          <n-input
            v-if="webSearchConfigDraft.searchApiProvider === 'bocha_search' || webSearchConfigDraft.searchApiProvider === 'brave_search'"
            v-model:value="webSearchConfigDraft.searchApiKey"
            type="password"
            show-password-toggle
            :placeholder="webSearchConfigDraft.searchApiProvider === 'bocha_search' ? '博查搜索 API Key' : 'Brave Search API Key'"
            clearable
          />
          <n-input
            v-if="webSearchConfigDraft.searchApiProvider === 'bocha_search' || webSearchConfigDraft.searchApiProvider === 'brave_search'"
            v-model:value="webSearchConfigDraft.searchApiEndpoint"
            :placeholder="webSearchConfigDraft.searchApiProvider === 'bocha_search' ? '默认：https://api.bochaai.com/v1/web-search' : '默认：https://api.search.brave.com/res/v1/web/search'"
            clearable
          />
          <n-input
            v-if="webSearchConfigDraft.searchApiProvider === 'bocha_search' || webSearchConfigDraft.searchApiProvider === 'brave_search'"
            v-model:value="webSearchConfigDraft.searchApiMarket"
            placeholder="搜索市场，例如：zh-CN"
            clearable
          />
          <n-checkbox v-model:checked="webSearchConfigDraft.allowInsecureTlsFallback">
            证书链异常时自动降级重试
          </n-checkbox>
        </n-flex>
      </n-card>

      <n-card hoverable>
        <n-flex justify="space-between" align="center" wrap :size="12">
          <n-flex vertical :size="6" style="min-width: 280px;">
            <n-text strong>默认系统提示词</n-text>
            <n-text depth="3" style="white-space: pre-wrap;">{{ systemPromptPreview }}</n-text>
          </n-flex>
          <n-button @click="openSystemPromptModal">编辑提示词</n-button>
        </n-flex>
      </n-card>

      <n-card hoverable>
        <n-flex vertical :size="12">
          <n-flex justify="space-between" align="center" wrap :size="12">
            <n-flex vertical :size="4">
              <n-text strong>图片 / 视频生成模式</n-text>
              <n-text depth="3">控制聊天页默认是否优先按图片或视频生成来解释请求。</n-text>
            </n-flex>
            <n-button type="primary" :loading="generationSaving" @click="saveGenerationModes">保存模式</n-button>
          </n-flex>
          <n-flex wrap :size="12">
            <n-form-item label="图片生成" style="flex: 1; min-width: 240px; margin-bottom: 0;">
              <n-select v-model:value="generationDraft.imageGenerationMode" :options="generationModeOptions" />
            </n-form-item>
            <n-form-item label="视频生成" style="flex: 1; min-width: 240px; margin-bottom: 0;">
              <n-select v-model:value="generationDraft.videoGenerationMode" :options="generationModeOptions" />
            </n-form-item>
          </n-flex>
        </n-flex>
      </n-card>

      <n-card hoverable>
        <n-flex justify="space-between" align="center" wrap :size="12">
          <n-flex vertical :size="6" style="min-width: 280px;">
            <n-text strong>聊天上下文窗口</n-text>
            <n-text depth="3">{{ contextWindowSummary }}</n-text>
          </n-flex>
          <n-button @click="openContextWindowModal">编辑上下文策略</n-button>
        </n-flex>
      </n-card>

      <n-card hoverable>
        <n-flex vertical :size="12">
          <n-flex justify="space-between" align="center" wrap :size="12">
            <n-flex vertical :size="4" style="min-width: 0; flex: 1 1 320px;">
              <n-text strong>同步中心</n-text>
              <n-text depth="3">{{ syncCenterSummary }}</n-text>
              <n-text depth="3" style="font-size: 12px;">
                云端同步与 MySQL 双端同步是两种独立方式，统一在这里二选一配置和执行。
              </n-text>
            </n-flex>
            <div class="sync-summary-toolbar">
              <n-button @click="openSyncCenterModal">编辑同步配置</n-button>
            </div>
          </n-flex>
          <div class="sync-summary-shell">
            <div class="sync-summary-head">
              <div class="sync-summary-head__copy">
                <n-text strong>{{ syncSummaryStatusTitle }}</n-text>
                <n-text depth="3">{{ syncSummaryStatusDescription }}</n-text>
              </div>
              <n-tag
                :type="syncSummaryStatusTagType"
                :bordered="false"
                round
              >
                {{ syncSummaryStatusTagLabel }}
              </n-tag>
            </div>
            <div class="sync-summary-badges">
              <span>{{ syncSummaryModeBadge }}</span>
              <span>{{ syncSummaryStorageBadge }}</span>
              <span>{{ syncSummaryIsolationBadge }}</span>
            </div>
            <div v-if="syncSummaryDetailItems.length" class="sync-summary-points">
              <div
                v-for="item in syncSummaryDetailItems"
                :key="item"
                class="sync-summary-point"
              >
                <span class="sync-summary-point__dot" />
                <n-text depth="3">{{ item }}</n-text>
              </div>
            </div>
          </div>
          <n-flex wrap :size="10">
            <n-button secondary :loading="syncCenterModal.testing" @click="handleTestSyncProvider">测试连接</n-button>
            <n-button :loading="syncActionLoading.backup" @click="confirmSyncAction('backup')">{{ syncBackupLabel }}</n-button>
            <n-button :loading="syncActionLoading.sync" @click="confirmSyncAction('sync')">{{ syncRunLabel }}</n-button>
            <n-button secondary :loading="syncActionLoading.restore" @click="confirmSyncAction('restore')">{{ syncRestoreLabel }}</n-button>
            <n-button
              v-if="mysqlConflictModal.items.length"
              tertiary
              @click="openMysqlConflictModal"
            >
              查看冲突详情
            </n-button>
          </n-flex>
          <n-alert
            v-if="syncActionFeedback.visible"
            :type="syncActionFeedback.status === 'error' ? 'error' : syncActionFeedback.status === 'success' ? 'success' : 'info'"
            :show-icon="syncActionFeedback.status !== 'running'"
            :bordered="false"
          >
            <n-flex vertical :size="8">
              <n-text strong>{{ syncActionFeedback.title }}</n-text>
              <n-text depth="3">{{ syncActionFeedback.summary }}</n-text>
              <n-progress
                v-if="syncActionFeedback.status === 'running' && syncActionFeedback.total > 0"
                type="line"
                processing
                :percentage="syncActionPercentage"
                indicator-placement="inside"
              />
              <n-text v-if="syncActionFeedback.detail" depth="3" style="font-size: 12px;">
                {{ syncActionFeedback.detail }}
              </n-text>
            </n-flex>
          </n-alert>
        </n-flex>
      </n-card>

      <n-card hoverable>
        <n-flex vertical :size="12">
          <n-flex justify="space-between" align="center" wrap :size="12">
            <n-flex vertical :size="4">
              <n-text strong>导入 / 导出配置</n-text>
              <n-text depth="3">
                导入会覆盖当前全局配置；导出会写出完整配置文件。若已设置全局配置密码，这两项操作都需要再次输入密码确认。
              </n-text>
            </n-flex>
          </n-flex>
          <n-flex wrap :size="10">
            <n-button @click="handleExportConfig">导出配置</n-button>
            <n-button secondary @click="handleImportConfig">导入配置</n-button>
          </n-flex>
        </n-flex>
      </n-card>

      <n-card hoverable>
        <n-flex vertical :size="12">
          <n-flex justify="space-between" align="center" wrap :size="12">
            <n-flex vertical :size="6">
              <n-text strong>全局配置密码</n-text>
              <n-text depth="3">
                {{ configPasswordSummary }}
              </n-text>
              <n-text v-if="configSecurity.recoveryQuestion" depth="3" style="font-size: 12px;">
                安全问题：{{ configSecurity.recoveryQuestion }}
              </n-text>
            </n-flex>
            <n-flex wrap :size="10">
              <n-button v-if="!hasConfigPassword" type="primary" @click="openConfigPasswordModal('set')">设置密码</n-button>
              <template v-else>
                <n-button @click="openConfigPasswordModal('change')">修改密码</n-button>
                <n-button secondary @click="openSecurityResetModal" :disabled="!hasRecoveryQuestion">安全问题重置</n-button>
                <n-button type="error" ghost @click="openConfigPasswordModal('clear')">清除密码</n-button>
              </template>
            </n-flex>
          </n-flex>
          <n-alert type="info" :show-icon="false">
            该密码同时作为“笔记密码重置”的全局凭据。修改、重置或清除时，会同步迁移或移除已绑定笔记中的恢复封装。
          </n-alert>
        </n-flex>
      </n-card>
    </n-flex>

    <n-modal v-model:show="systemPromptModal.show" preset="card" title="编辑默认系统提示词" style="width: 820px; max-width: 95%;">
      <n-input
        v-model:value="systemPromptModal.value"
        type="textarea"
        :autosize="{ minRows: 10, maxRows: 18 }"
        placeholder="输入默认系统提示词"
      />
      <template #footer>
        <n-flex justify="flex-end" :size="12">
          <n-button @click="closeSystemPromptModal">取消</n-button>
          <n-button type="primary" :loading="systemPromptModal.loading" @click="saveSystemPrompt">保存</n-button>
        </n-flex>
      </template>
    </n-modal>

    <n-modal v-model:show="contextWindowModal.show" preset="card" title="编辑上下文窗口策略" style="width: 720px; max-width: 95%;">
      <n-form label-placement="left" label-width="120px">
        <n-form-item label="预设">
          <n-select v-model:value="contextWindowDraft.preset" :options="contextWindowPresetOptions" />
        </n-form-item>
        <n-form-item label="历史侧重点">
          <n-select v-model:value="contextWindowDraft.historyFocus" :options="contextWindowHistoryFocusOptions" />
        </n-form-item>
        <template v-if="contextWindowDraft.preset === 'custom'">
          <n-form-item label="最大轮次">
            <n-input-number v-model:value="contextWindowDraft.maxTurns" :min="2" :max="200" style="width: 220px;" />
          </n-form-item>
          <n-form-item label="完整保留轮次">
            <n-input-number v-model:value="contextWindowDraft.keepRecentTurnsFull" :min="1" :max="64" style="width: 220px;" />
          </n-form-item>
          <n-form-item label="最大消息数">
            <n-input-number v-model:value="contextWindowDraft.maxMessages" :min="8" :max="1000" style="width: 220px;" />
          </n-form-item>
          <n-form-item label="展开字符预算">
            <n-input-number v-model:value="contextWindowDraft.maxCharsExpanded" :min="4000" :max="4200000" :step="10000" style="width: 220px;" />
          </n-form-item>
          <n-form-item label="压缩字符预算">
            <n-input-number v-model:value="contextWindowDraft.maxCharsCompact" :min="6000" :max="4200000" :step="10000" style="width: 220px;" />
          </n-form-item>
        </template>
      </n-form>
      <template #footer>
        <n-flex justify="flex-end" :size="12">
          <n-button @click="closeContextWindowModal">取消</n-button>
          <n-button type="primary" :loading="contextWindowModal.loading" @click="saveContextWindow">保存</n-button>
        </n-flex>
      </template>
    </n-modal>

    <n-modal
      v-model:show="notebookRuntimeModal.show"
      preset="card"
      title="Notebook Runtime 配置"
      :class="['notebook-runtime-modal', { 'is-dark': theme === 'dark' }]"
      style="width: 760px; max-width: 95%;"
    >
      <n-flex vertical :size="12">
        <n-alert type="info" :show-icon="false">
          Notebook Runtime 配置只保存在当前电脑本地，不参与云同步，也不会被导入导出配置覆盖。
        </n-alert>
        <n-alert :type="notebookLspStatus.type === 'success' ? 'success' : 'warning'" :show-icon="false">
          {{ notebookLspStatusHelp }}
        </n-alert>
        <n-form label-placement="left" label-width="140px">
          <n-form-item label="Python 解释器">
            <n-input v-model:value="notebookRuntimeModal.form.pythonPath" placeholder="留空则优先使用自动检测到的 Python" />
          </n-form-item>
          <n-form-item label="虚拟环境存储目录">
            <n-flex vertical :size="8" style="width: 100%;">
              <n-input v-model:value="notebookRuntimeModal.form.venvRoot" placeholder="留空则使用本机默认目录" />
              <n-flex :size="8" wrap>
                <n-button secondary @click="handlePickNotebookVenvRoot">选择目录</n-button>
                <n-button secondary @click="handleResetNotebookVenvRoot">恢复默认</n-button>
              </n-flex>
              <n-text depth="3" style="word-break: break-all;">
                默认目录：{{ defaultNotebookVenvRootText }}
              </n-text>
            </n-flex>
          </n-form-item>
          <n-form-item label="自动检测结果">
            <n-flex vertical :size="8" style="width: 100%;">
              <n-text depth="3" style="word-break: break-all;">
                {{ detectedNotebookPythonText }}
              </n-text>
              <n-button secondary style="width: fit-content;" :loading="notebookRuntimeDetecting" @click="handleUseDetectedNotebookPython">
                使用检测结果
              </n-button>
            </n-flex>
          </n-form-item>
          <n-form-item label="默认 Kernel">
            <n-input v-model:value="notebookRuntimeModal.form.kernelName" placeholder="留空则使用环境默认 kernel" />
          </n-form-item>
          <n-form-item label="启动超时(ms)">
            <n-flex vertical :size="6" style="width: 100%;">
              <n-input-number v-model:value="notebookRuntimeModal.form.startupTimeoutMs" :min="0" :max="120000" :step="1000" style="width: 220px;" />
              <n-text depth="3">填 0 表示永不超时。</n-text>
            </n-flex>
          </n-form-item>
          <n-form-item label="执行超时(ms)">
            <n-flex vertical :size="6" style="width: 100%;">
              <n-input-number v-model:value="notebookRuntimeModal.form.executeTimeoutMs" :min="0" :max="600000" :step="1000" style="width: 220px;" />
              <n-text depth="3">填 0 表示永不超时。</n-text>
            </n-flex>
          </n-form-item>
        </n-form>
        <div v-if="notebookRuntimeHasConfiguredPython" class="notebook-runtime-dependency-panel">
          <div class="notebook-runtime-dependency-panel__header">
            <div class="notebook-runtime-dependency-panel__copy">
              <n-text strong>依赖与安全安装</n-text>
              <n-text depth="3">安装只作用于当前解释器和当前电脑，不会参与同步，也不会上传到云端。</n-text>
            </div>
            <n-tag :type="notebookDependencyStatus.type" :bordered="false">
              {{ notebookDependencyStatus.label }}
            </n-tag>
          </div>

          <div class="notebook-runtime-dependency-status">
            <div
              v-for="line in notebookDependencyStatusLines"
              :key="line"
              class="notebook-runtime-dependency-status__line"
            >
              <span class="notebook-runtime-dependency-status__dot" />
              <n-text depth="3">{{ line }}</n-text>
            </div>
          </div>

          <div class="notebook-runtime-command-panel">
            <div class="notebook-runtime-command-panel__head">
              <n-text strong>安装命令</n-text>
              <n-tag :bordered="false" type="default" size="small">当前解释器</n-tag>
            </div>
            <pre>{{ notebookDependencyInstallCommand }}</pre>
          </div>

          <div class="notebook-runtime-dependency-grid">
            <div
              v-for="item in notebookDependencyItems"
              :key="item.key"
              class="notebook-runtime-dependency-item"
              :class="{ 'is-installed': item.installed }"
            >
              <div class="notebook-runtime-dependency-item__copy">
                <n-text strong>{{ item.label }}</n-text>
                <n-text depth="3">{{ item.installed ? '已检测到' : '未安装或当前解释器不可用' }}</n-text>
              </div>
              <n-tag :type="item.installed ? 'success' : 'warning'" :bordered="false" size="small">
                {{ item.installed ? '已就绪' : '待安装' }}
              </n-tag>
            </div>
          </div>

          <div class="notebook-runtime-dependency-actions">
            <n-button secondary :loading="notebookRuntimeDetecting" @click="refreshNotebookPythonDetection">
              刷新状态
            </n-button>
            <n-button
              type="primary"
              :loading="notebookDependencyState.installing"
              @click="installNotebookRuntimeDependencies"
            >
              安装当前解释器依赖
            </n-button>
          </div>

          <div
            v-if="notebookDependencyState.progressMessage || notebookDependencyState.logs"
            class="notebook-runtime-dependency-log"
          >
            <div class="notebook-runtime-dependency-log__head">
              <n-text strong>安装过程</n-text>
              <n-tag
                :bordered="false"
                :type="notebookDependencyState.installing ? 'info' : notebookDependencyState.progressMessage === '依赖安装完成' ? 'success' : 'warning'"
                size="small"
              >
                {{ notebookDependencyState.installing ? '安装中' : notebookDependencyState.progressMessage === '依赖安装完成' ? '已完成' : '已停止' }}
              </n-tag>
            </div>
            <div v-if="notebookDependencyState.progressMessage" class="notebook-runtime-dependency-log__summary">
              {{ notebookDependencyState.progressMessage }}
            </div>
            <pre v-if="notebookDependencyState.logs">{{ notebookDependencyState.logs }}</pre>
          </div>
        </div>
      </n-flex>
      <template #footer>
        <n-flex justify="space-between" align="center" :size="12">
          <n-button secondary :loading="notebookRuntimeDetecting" @click="refreshNotebookPythonDetection">重新检测 Python</n-button>
          <n-flex justify="flex-end" :size="12">
            <n-button @click="closeNotebookRuntimeModal">取消</n-button>
            <n-button type="primary" :loading="notebookRuntimeModal.loading" @click="saveNotebookRuntimeConfig">保存</n-button>
          </n-flex>
        </n-flex>
      </template>
    </n-modal>

    <n-modal
      v-model:show="syncCenterModal.show"
      preset="card"
      title="编辑同步中心配置"
      :class="['sync-center-modal', { 'is-dark': theme === 'dark' }]"
      style="width: 860px; max-width: 95%;"
    >
      <n-flex vertical :size="12">
        <n-alert type="info" :show-icon="false">
          同步始终只作用于当前用户。云端同步和 MySQL 双端同步是两种独立方式，只会按当前选中的一种执行，不会混合运行。
        </n-alert>
        <div class="sync-modal-overview">
          <div class="sync-modal-overview__status">
            <div class="sync-modal-overview__status-copy">
              <n-text strong>同步总开关</n-text>
              <n-text depth="3">关闭后不会执行任何同步任务，已保存配置会继续保留。</n-text>
            </div>
            <n-switch v-model:value="syncCenterModal.form.enabled">
              <template #checked>已启用</template>
              <template #unchecked>已关闭</template>
            </n-switch>
          </div>
          <div class="sync-modal-overview__mode">
            <div class="sync-modal-overview__label">
              <n-text strong>同步方式</n-text>
              <n-text depth="3">二选一配置。云端同步使用 SQLite 快照，MySQL 双端同步使用记录级收敛。</n-text>
            </div>
            <div class="sync-mode-grid">
              <button
                type="button"
                class="sync-mode-card"
                :class="{ 'is-active': syncCenterModal.form.provider === 'cloud' }"
                @click="syncCenterModal.form.provider = 'cloud'"
              >
                <div class="sync-mode-card__top">
                  <n-tag size="small" :bordered="false" type="info">云端同步</n-tag>
                  <n-text depth="3">SQLite 快照</n-text>
                </div>
                <div class="sync-mode-card__body">
                  <n-text strong>对象存储云端同步</n-text>
                  <n-text depth="3">
                    将当前用户数据打包为一个 SQLite 快照上传到对象存储，适合做整包同步和恢复。
                  </n-text>
                </div>
                <div class="sync-mode-card__meta">
                  <span>整包快照</span>
                  <span>恢复简单</span>
                  <span>对象存储</span>
                </div>
              </button>

              <button
                type="button"
                class="sync-mode-card"
                :class="{ 'is-active': syncCenterModal.form.provider === 'mysql' }"
                @click="syncCenterModal.form.provider = 'mysql'"
              >
                <div class="sync-mode-card__top">
                  <n-tag size="small" :bordered="false" type="success">MySQL 双端同步</n-tag>
                  <n-text depth="3">记录级同步</n-text>
                </div>
                <div class="sync-mode-card__body">
                  <n-text strong>数据库双端同步</n-text>
                  <n-text depth="3">
                    将当前用户数据按记录写入 MySQL，支持范围控制、双向收敛和冲突策略处理。
                  </n-text>
                </div>
                <div class="sync-mode-card__meta">
                  <span>记录级</span>
                  <span>可控范围</span>
                  <span>冲突策略</span>
                </div>
              </button>
            </div>
          </div>
        </div>
        <n-form label-placement="top" class="sync-center-form">
          <template v-if="syncCenterModal.form.provider === 'cloud'">
            <div class="sync-config-panel sync-config-panel--cloud">
              <div class="sync-config-panel__hero">
                <div class="sync-config-panel__hero-copy">
                  <n-text strong>云端同步配置</n-text>
                  <n-text depth="3">把当前用户的笔记、配置、会话等数据打包为 SQLite 快照，并上传到对象存储。</n-text>
                </div>
                <n-tag :bordered="false" type="info">当前方式</n-tag>
              </div>

              <div class="sync-config-section">
                <div class="sync-config-section__header">
                  <n-text strong>接入信息</n-text>
                  <n-text depth="3">用于连接对象存储服务，可先选厂商预设，再按需微调 endpoint。</n-text>
                </div>
                <div class="cloud-provider-preset-shell">
                  <n-form-item label="对象存储厂商">
                    <n-select
                      v-model:value="syncCenterModal.form.cloud.provider"
                      :options="cloudProviderOptions"
                    />
                  </n-form-item>
                  <div class="cloud-provider-preset-card">
                    <div class="cloud-provider-preset-card__head">
                      <n-text strong>{{ activeCloudProviderPreset.label }}</n-text>
                      <n-tag :bordered="false" type="info">{{ activeCloudProviderPreset.vendorLabel }}</n-tag>
                    </div>
                    <n-text depth="3">{{ activeCloudProviderPreset.regionHint }}</n-text>
                    <n-text depth="3">{{ activeCloudProviderPreset.endpointHint }}</n-text>
                  </div>
                </div>
                <div class="sync-config-form-grid">
                  <n-form-item label="Region">
                    <n-input
                      v-model:value="syncCenterModal.form.cloud.region"
                      :placeholder="activeCloudProviderPreset.regionPlaceholder"
                    />
                  </n-form-item>
                  <n-form-item :label="activeCloudProviderPreset.bucketLabel">
                    <n-input
                      v-model:value="syncCenterModal.form.cloud.bucket"
                      :placeholder="activeCloudProviderPreset.bucketPlaceholder"
                    />
                  </n-form-item>
                  <n-form-item label="Access Key ID">
                    <n-input v-model:value="syncCenterModal.form.cloud.accessKeyId" placeholder="输入 Access Key ID" />
                  </n-form-item>
                  <n-form-item label="Secret Access Key">
                    <n-input v-model:value="syncCenterModal.form.cloud.secretAccessKey" type="password" show-password-toggle placeholder="输入 Secret Access Key" />
                  </n-form-item>
                  <n-form-item class="sync-config-form-grid__full" label="Endpoint">
                    <n-flex vertical :size="6" style="width: 100%;">
                      <n-input
                        v-model:value="syncCenterModal.form.cloud.endpoint"
                        :placeholder="activeCloudProviderPreset.endpointPlaceholder"
                      />
                      <n-text depth="3" style="font-size: 12px;">
                        推荐格式：{{ activeCloudProviderPreset.endpointTemplate }}
                      </n-text>
                    </n-flex>
                  </n-form-item>
                </div>
              </div>

              <div class="sync-config-section">
                <div class="sync-config-section__header">
                  <n-text strong>快照存储策略</n-text>
                  <n-text depth="3">控制云端 SQLite 快照的存放方式</n-text>
                </div>
                <div class="sync-config-form-grid">
                  <n-form-item label="对象前缀">
                    <n-input v-model:value="syncCenterModal.form.cloud.objectPrefix" placeholder="例如：ai-tools-sync" />
                  </n-form-item>
                  <n-form-item label="Force Path Style">
                    <n-switch v-model:value="syncCenterModal.form.cloud.forcePathStyle" />
                  </n-form-item>
                  <n-form-item class="sync-config-form-grid__full" label="证书策略">
                    <n-flex vertical :size="6" style="width: 100%;">
                      <n-switch v-model:value="syncCenterModal.form.cloud.allowSelfSignedCertificates">
                        <template #checked>允许自签名证书</template>
                        <template #unchecked>严格校验证书</template>
                      </n-switch>
                      <n-text depth="3" style="font-size: 12px;">
                        如果对象存储使用内网证书或自签名证书，可先开启此项再测试连接。
                      </n-text>
                    </n-flex>
                  </n-form-item>
                </div>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="sync-config-panel sync-config-panel--mysql">
              <div class="sync-config-panel__hero">
                <div class="sync-config-panel__hero-copy">
                  <n-text strong>MySQL 双端同步配置</n-text>
                  <n-text depth="3">把当前用户数据按记录写入 MySQL，并按冲突策略执行双向同步和冲突处理。</n-text>
                </div>
                <n-tag :bordered="false" type="success">当前方式</n-tag>
              </div>

              <div class="sync-config-section">
                <div class="sync-config-section__header">
                  <n-text strong>连接信息</n-text>
                  <n-text depth="3">用于连接 MySQL 数据库</n-text>
                </div>
                <div class="sync-config-form-grid">
                  <n-form-item label="Host">
                    <n-input v-model:value="syncCenterModal.form.mysql.host" placeholder="例如：127.0.0.1" />
                  </n-form-item>
                  <n-form-item label="Port">
                    <n-input-number v-model:value="syncCenterModal.form.mysql.port" :min="1" :max="65535" style="width: 100%;" />
                  </n-form-item>
                  <n-form-item label="Database">
                    <n-input v-model:value="syncCenterModal.form.mysql.database" placeholder="输入数据库名" />
                  </n-form-item>
                  <n-form-item label="Username">
                    <n-input v-model:value="syncCenterModal.form.mysql.username" placeholder="输入用户名" />
                  </n-form-item>
                  <n-form-item label="Password">
                    <n-input v-model:value="syncCenterModal.form.mysql.password" type="password" show-password-toggle placeholder="输入密码" />
                  </n-form-item>
                </div>
              </div>

              <div class="sync-config-section">
                <div class="sync-config-section__header">
                  <n-text strong>同步策略</n-text>
                  <n-text depth="3">控制连接行为和冲突处理方式</n-text>
                </div>
                <div class="sync-config-form-grid">
                  <n-form-item label="冲突策略">
                    <n-select
                      v-model:value="syncCenterModal.form.conflictPolicy"
                      :options="[
                        { label: '最后写入覆盖', value: 'last_write_wins' },
                        { label: '手动处理（返回冲突清单）', value: 'manual' }
                      ]"
                    />
                  </n-form-item>
                </div>
              </div>
            </div>
          </template>

          <div v-if="syncCenterModal.form.provider === 'mysql'" class="mysql-sync-scope-panel">
            <div class="mysql-sync-scope-panel__header">
              <n-text strong>同步范围</n-text>
              <n-text depth="3">按当前用户维度选择需要纳入 MySQL 双端同步的内容范围。</n-text>
            </div>
            <div class="mysql-sync-scope-grid">
              <div class="mysql-sync-scope-card" :class="{ 'is-enabled': syncCenterModal.form.scope.notes }">
                <div class="mysql-sync-scope-copy">
                  <div class="mysql-sync-scope-head">
                    <n-text strong>笔记文件</n-text>
                    <n-text depth="3">Markdown / ipynb / 附件资源</n-text>
                  </div>
                  <n-text depth="3">
                    同步当前用户 `note/` 目录下的笔记正文与资源文件。
                  </n-text>
                </div>
                <div class="mysql-sync-scope-toggle">
                  <n-text depth="3">同步此项</n-text>
                  <n-switch v-model:value="syncCenterModal.form.scope.notes">
                    <template #checked>开启</template>
                    <template #unchecked>关闭</template>
                  </n-switch>
                </div>
              </div>

              <div class="mysql-sync-scope-card" :class="{ 'is-enabled': syncCenterModal.form.scope.noteMeta }">
                <div class="mysql-sync-scope-copy">
                  <div class="mysql-sync-scope-head">
                    <n-text strong>笔记保护元信息</n-text>
                    <n-text depth="3">密码 / 恢复封装 / 保护状态</n-text>
                  </div>
                  <n-text depth="3">
                    只同步笔记安全配置，不覆盖其它全局配置内容。
                  </n-text>
                </div>
                <div class="mysql-sync-scope-toggle">
                  <n-text depth="3">同步此项</n-text>
                  <n-switch v-model:value="syncCenterModal.form.scope.noteMeta">
                    <template #checked>开启</template>
                    <template #unchecked>关闭</template>
                  </n-switch>
                </div>
              </div>

              <div class="mysql-sync-scope-card" :class="{ 'is-enabled': syncCenterModal.form.scope.config }">
                <div class="mysql-sync-scope-copy">
                  <div class="mysql-sync-scope-head">
                    <n-text strong>全局配置</n-text>
                    <n-text depth="3">当前用户配置项</n-text>
                  </div>
                  <n-text depth="3">
                    同步模型参数、偏好设置以及当前用户的全局配置。
                  </n-text>
                </div>
                <div class="mysql-sync-scope-toggle">
                  <n-text depth="3">同步此项</n-text>
                  <n-switch v-model:value="syncCenterModal.form.scope.config">
                    <template #checked>开启</template>
                    <template #unchecked>关闭</template>
                  </n-switch>
                </div>
              </div>

              <div class="mysql-sync-scope-card" :class="{ 'is-enabled': syncCenterModal.form.scope.sessions }">
                <div class="mysql-sync-scope-copy">
                  <div class="mysql-sync-scope-head">
                    <n-text strong>会话文件</n-text>
                    <n-text depth="3">聊天历史 / session 数据</n-text>
                  </div>
                  <n-text depth="3">
                    同步当前用户 `session/` 目录下的历史会话与索引数据。
                  </n-text>
                </div>
                <div class="mysql-sync-scope-toggle">
                  <n-text depth="3">同步此项</n-text>
                  <n-switch v-model:value="syncCenterModal.form.scope.sessions">
                    <template #checked>开启</template>
                    <template #unchecked>关闭</template>
                  </n-switch>
                </div>
              </div>
            </div>
          </div>
        </n-form>
      </n-flex>
      <template #footer>
        <n-flex justify="space-between" align="center" :size="12">
          <n-flex vertical :size="8" style="flex: 1; min-width: 0;">
            <n-flex align="center" :size="12">
              <n-button secondary :loading="syncCenterModal.testing" @click="handleTestSyncProvider">测试连接</n-button>
              <n-text
                v-if="syncCenterModal.testResult.message"
                :type="syncCenterModal.testResult.status === 'success' ? 'success' : syncCenterModal.testResult.status === 'error' ? 'error' : 'default'"
                depth="3"
                class="sync-test-feedback"
              >
                {{ syncCenterModal.testResult.message }}
              </n-text>
            </n-flex>
          </n-flex>
          <n-flex justify="flex-end" :size="12">
            <n-button @click="closeSyncCenterModal">取消</n-button>
            <n-button type="primary" :loading="syncCenterModal.loading" @click="saveSyncCenterConfig">保存</n-button>
          </n-flex>
        </n-flex>
      </template>
    </n-modal>

    <n-modal v-model:show="mysqlConflictModal.show" preset="card" title="MySQL 同步冲突详情" style="width: 920px; max-width: 96%;">
      <n-flex vertical :size="12">
        <n-alert type="warning" :show-icon="false">
          当前冲突策略是手动处理。以下项目未自动覆盖，需要你确认保留本地还是远端。
        </n-alert>
        <n-flex justify="space-between" align="center" wrap :size="12">
          <n-text depth="3">共 {{ mysqlConflictModal.items.length }} 项冲突</n-text>
          <n-button tertiary @click="clearMysqlConflictModal">清空列表</n-button>
        </n-flex>
        <n-card
          v-for="item in mysqlConflictModal.items"
          :key="`${item.type}:${item.key}`"
          size="small"
          embedded
          class="mysql-conflict-card"
        >
          <div class="mysql-conflict-card__layout">
            <div class="mysql-conflict-card__main">
              <div class="mysql-conflict-card__header">
                <n-tag bordered :type="getMysqlConflictTypeTag(item.type)">{{ getMysqlConflictTypeLabel(item.type) }}</n-tag>
                <n-text code class="mysql-conflict-card__key">{{ item.key }}</n-text>
              </div>

              <div class="mysql-conflict-card__grid">
                <div class="mysql-conflict-side mysql-conflict-side--local">
                  <n-text strong>本地版本</n-text>
                  <n-text depth="3">更新时间：{{ formatMysqlConflictTime(item.localUpdatedAt) }}</n-text>
                  <n-text depth="3">内容 Hash：{{ formatMysqlConflictHash(item.localHash) }}</n-text>
                </div>

                <div class="mysql-conflict-side mysql-conflict-side--remote">
                  <n-text strong>远端版本</n-text>
                  <n-text depth="3">更新时间：{{ formatMysqlConflictTime(item.remoteUpdatedAt) }}</n-text>
                  <n-text depth="3">内容 Hash：{{ formatMysqlConflictHash(item.remoteHash) }}</n-text>
                </div>
              </div>
            </div>

            <n-flex vertical :size="8" class="mysql-conflict-card__actions">
              <n-button
                size="small"
                type="primary"
                :loading="isMysqlConflictResolving(item, 'local')"
                @click="handleMysqlConflictResolution(item, 'local')"
              >
                保留本地
              </n-button>
              <n-button
                size="small"
                secondary
                :loading="isMysqlConflictResolving(item, 'remote')"
                @click="handleMysqlConflictResolution(item, 'remote')"
              >
                保留远端
              </n-button>
            </n-flex>
          </div>
        </n-card>
      </n-flex>
      <template #footer>
        <n-flex justify="flex-end" :size="12">
          <n-button @click="mysqlConflictModal.show = false">关闭</n-button>
        </n-flex>
      </template>
    </n-modal>

    <n-modal v-model:show="configPasswordModal.show" preset="card" :title="configPasswordModalTitle" style="width: 560px; max-width: 95%;" :mask-closable="false">
      <n-flex vertical :size="12">
        <n-alert v-if="configPasswordModal.mode === 'clear'" type="warning" :show-icon="false">
          清除后，进入全局配置页、导入导出校验以及笔记密码重置的全局凭据都会一起失效。
        </n-alert>
        <n-input
          v-if="configPasswordModal.mode !== 'set'"
          v-model:value="configPasswordModal.currentPassword"
          type="password"
          show-password-toggle
          :placeholder="configPasswordModal.mode === 'clear' ? '输入当前全局配置密码' : '输入当前全局配置密码'"
        />
        <template v-if="configPasswordModal.mode !== 'clear'">
          <n-input
            v-model:value="configPasswordModal.newPassword"
            type="password"
            show-password-toggle
            placeholder="输入新的全局配置密码"
          />
          <n-input
            v-model:value="configPasswordModal.confirmPassword"
            type="password"
            show-password-toggle
            placeholder="再次输入新的全局配置密码"
          />
          <n-input
            v-model:value="configPasswordModal.recoveryQuestion"
            placeholder="设置一个安全问题"
          />
          <n-input
            v-model:value="configPasswordModal.recoveryAnswer"
            type="password"
            show-password-toggle
            placeholder="输入安全问题答案"
          />
          <n-input
            v-model:value="configPasswordModal.recoveryAnswerConfirm"
            type="password"
            show-password-toggle
            placeholder="再次输入安全问题答案"
            @keydown.enter.prevent="submitConfigPasswordModal"
          />
        </template>
      </n-flex>
      <template #footer>
        <n-flex justify="flex-end" :size="12">
          <n-button @click="closeConfigPasswordModal">取消</n-button>
          <n-button :type="configPasswordModal.mode === 'clear' ? 'error' : 'primary'" :loading="configPasswordModal.loading" @click="submitConfigPasswordModal">
            {{ configPasswordModal.mode === 'clear' ? '清除密码' : '保存' }}
          </n-button>
        </n-flex>
      </template>
    </n-modal>

    <n-modal v-model:show="securityResetModal.show" preset="card" title="通过安全问题重置全局配置密码" style="width: 560px; max-width: 95%;" :mask-closable="false">
      <n-flex vertical :size="12">
        <n-alert type="info" :show-icon="false">
          当前安全问题：{{ configSecurity.recoveryQuestion || '未设置' }}
        </n-alert>
        <n-input
          v-model:value="securityResetModal.answer"
          type="password"
          show-password-toggle
          placeholder="输入当前安全问题答案"
        />
        <n-input
          v-model:value="securityResetModal.newPassword"
          type="password"
          show-password-toggle
          placeholder="输入新的全局配置密码"
        />
        <n-input
          v-model:value="securityResetModal.confirmPassword"
          type="password"
          show-password-toggle
          placeholder="再次输入新的全局配置密码"
        />
        <n-input
          v-model:value="securityResetModal.recoveryQuestion"
          placeholder="设置新的安全问题"
        />
        <n-input
          v-model:value="securityResetModal.recoveryAnswer"
          type="password"
          show-password-toggle
          placeholder="输入新的安全问题答案"
        />
        <n-input
          v-model:value="securityResetModal.recoveryAnswerConfirm"
          type="password"
          show-password-toggle
          placeholder="再次输入新的安全问题答案"
          @keydown.enter.prevent="submitSecurityReset"
        />
      </n-flex>
      <template #footer>
        <n-flex justify="flex-end" :size="12">
          <n-button @click="closeSecurityResetModal">取消</n-button>
          <n-button type="primary" :loading="securityResetModal.loading" @click="submitSecurityReset">重置密码</n-button>
        </n-flex>
      </template>
    </n-modal>

    <n-modal v-model:show="actionPasswordModal.show" preset="card" :title="actionPasswordModal.title" style="width: 460px; max-width: 95%;" :mask-closable="false">
      <n-flex vertical :size="12">
        <n-text depth="3">{{ actionPasswordModal.description }}</n-text>
        <n-input
          v-model:value="actionPasswordModal.password"
          type="password"
          show-password-toggle
          placeholder="输入当前全局配置密码"
          @keydown.enter.prevent="submitActionPassword"
        />
      </n-flex>
      <template #footer>
        <n-flex justify="flex-end" :size="12">
          <n-button @click="closeActionPasswordModal">取消</n-button>
          <n-button type="primary" :loading="actionPasswordModal.loading" @click="submitActionPassword">确认</n-button>
        </n-flex>
      </template>
    </n-modal>
  </n-flex>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NFlex,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NProgress,
  NSelect,
  NSwitch,
  NTag,
  NText,
  useDialog,
  useMessage
} from 'naive-ui'
import {
  cutTheme,
  exportGlobalConfigToFile,
  getChatConfig,
  getConfigSecurity,
  getCloudConfig,
  getDataStorageRoot,
  getNoteConfig,
  getSyncConfig,
  getTheme,
  getWebSearchConfig,
  importGlobalConfigFromFile,
  resetDataStorageRoot,
  setDataStorageRoot,
  updateChatConfig,
  updateGlobalConfig,
  updateNoteConfig,
  updateCloudConfig,
  updateSyncConfig,
  updateWebSearchConfig
} from '@/utils/configListener'
import {
  backupSync,
  describeFileOperationsError,
  readFile,
  restoreSync,
  resolveMysqlConflict,
  runSync,
  testUnifiedSync,
  writeFile
} from '@/utils/fileOperations'
import {
  changeFallbackPassword,
  createPasswordVerifier,
  decryptTextWithPassword,
  encryptTextWithPassword,
  hasFallbackRecovery,
  normalizeNoteSecurityConfig,
  verifyPassword
} from '@/utils/noteEncryption'
import {
  CHAT_CONTEXT_WINDOW_PRESETS,
  DEFAULT_CHAT_CONTEXT_WINDOW_CONFIG,
  normalizeChatContextWindowConfig
} from '@/utils/chatContextWindow'
import { checkNotebookPythonLsp, detectNotebookPython, installNotebookDependencies, listNotebookPythonModules } from '@/utils/notebookRuntime'
import { normalizeNotebookRuntimeConfig } from '@/utils/notebookRuntimeConfig'

const CONFIG_ACCESS_SESSION_KEY = '__ai_tools_config_access_password__'
const EMPTY_CONFIG_SECURITY = Object.freeze({
  passwordVerifier: null,
  recoveryQuestion: '',
  recoveryAnswerVerifier: null,
  passwordRecoveryEnvelope: ''
})

const generationModeOptions = [
  { label: '自动', value: 'auto' },
  { label: '开启', value: 'on' },
  { label: '关闭', value: 'off' }
]

const contextWindowPresetOptions = [
  { label: '紧凑', value: 'aggressive' },
  { label: '平衡', value: 'balanced' },
  { label: '宽松', value: 'wide' },
  { label: '自定义', value: 'custom' }
]

const contextWindowHistoryFocusOptions = [
  { label: '优先最近', value: 'recent' },
  { label: '平衡', value: 'balanced' },
  { label: '优先附件', value: 'attachments' }
]

const webSearchApiProviderOptions = [
  { label: '仅使用 HTML 搜索兜底', value: 'none' },
  { label: '博查搜索 API（国内友好，完整网页搜索）', value: 'bocha_search' },
  { label: 'DuckDuckGo Instant Answer（官方问答，不是完整网页搜索）', value: 'duckduckgo_instant_answer' },
  { label: 'Brave Search API（完整网页搜索）', value: 'brave_search' }
]

const NOTEBOOK_REQUIRED_MODULES = [
  { key: 'jupyter_client', label: 'jupyter_client' },
  { key: 'ipykernel', label: 'ipykernel' },
  { key: 'jedi_language_server', label: 'jedi-language-server' }
]

const CLOUD_PROVIDER_PRESETS = {
  generic_s3: {
    label: '通用 S3',
    vendorLabel: 'S3 Compatible',
    bucketLabel: 'Bucket',
    bucketPlaceholder: '输入 Bucket 名称',
    regionPlaceholder: '例如：ap-southeast-1',
    endpointPlaceholder: '例如：https://s3.ap-southeast-1.amazonaws.com',
    endpointTemplate: 'https://s3.{region}.amazonaws.com',
    regionHint: '适用于 AWS S3 或其它兼容 S3 的对象存储服务。',
    endpointHint: '可直接使用默认 S3 风格 endpoint，也可手动填写兼容网关地址。',
    forcePathStyle: false
  },
  huawei_obs: {
    label: '华为云',
    vendorLabel: 'OBS',
    bucketLabel: 'Bucket / OBS',
    bucketPlaceholder: '输入 OBS Bucket 名称',
    regionPlaceholder: '例如：cn-north-4',
    endpointPlaceholder: '例如：https://obs.cn-north-4.myhuaweicloud.com',
    endpointTemplate: 'https://obs.{region}.myhuaweicloud.com',
    regionHint: 'Region 通常为 `cn-north-4`、`ap-southeast-3` 这类区域编码。',
    endpointHint: 'OBS 常用 endpoint 形态为 `obs.{region}.myhuaweicloud.com`。',
    forcePathStyle: false
  },
  aliyun_oss: {
    label: '阿里云',
    vendorLabel: 'OSS',
    bucketLabel: 'Bucket / OSS',
    bucketPlaceholder: '输入 OSS Bucket 名称',
    regionPlaceholder: '例如：cn-hangzhou',
    endpointPlaceholder: '例如：https://oss-cn-hangzhou.aliyuncs.com',
    endpointTemplate: 'https://oss-{region}.aliyuncs.com',
    regionHint: 'Region 通常为 `cn-hangzhou`、`ap-southeast-1` 这类 OSS 区域名。',
    endpointHint: 'OSS 常用 endpoint 形态为 `oss-{region}.aliyuncs.com`。',
    forcePathStyle: false
  },
  volcengine_tos: {
    label: '字节云',
    vendorLabel: 'TOS',
    bucketLabel: 'Bucket / TOS',
    bucketPlaceholder: '输入 TOS Bucket 名称',
    regionPlaceholder: '例如：cn-beijing',
    endpointPlaceholder: '例如：https://tos-s3-cn-beijing.volces.com',
    endpointTemplate: 'https://tos-s3-{region}.volces.com',
    regionHint: 'Region 通常为 `cn-beijing`、`ap-southeast-1` 这类 TOS 区域名。',
    endpointHint: 'TOS 常用 S3 兼容 endpoint 形态为 `tos-s3-{region}.volces.com`。',
    forcePathStyle: false
  },
  tencent_cos: {
    label: '腾讯云',
    vendorLabel: 'COS',
    bucketLabel: 'Bucket / COS',
    bucketPlaceholder: '输入 COS Bucket 名称',
    regionPlaceholder: '例如：ap-shanghai',
    endpointPlaceholder: '例如：https://cos.ap-shanghai.myqcloud.com',
    endpointTemplate: 'https://cos.{region}.myqcloud.com',
    regionHint: 'Region 通常为 `ap-shanghai`、`ap-guangzhou` 这类 COS 地域编码。',
    endpointHint: 'COS 常用 endpoint 形态为 `cos.{region}.myqcloud.com`。',
    forcePathStyle: false
  }
}

const cloudProviderOptions = [
  { label: '通用 S3', value: 'generic_s3' },
  { label: '华为云 OBS', value: 'huawei_obs' },
  { label: '阿里云 OSS', value: 'aliyun_oss' },
  { label: '字节云 TOS', value: 'volcengine_tos' },
  { label: '腾讯云 COS', value: 'tencent_cos' }
]

const theme = getTheme()
const dialog = useDialog()
const message = useMessage()
const chatConfig = getChatConfig()
const noteConfig = getNoteConfig()
const rawConfigSecurity = getConfigSecurity()
const dataStorageRoot = getDataStorageRoot()
const cloudConfig = getCloudConfig()
const syncConfig = getSyncConfig()
const webSearchConfig = getWebSearchConfig()

const configAccessReady = ref(false)
const configPageUnlocked = ref(false)
const pageUnlockPassword = ref('')
const pageUnlockLoading = ref(false)
let accessSyncToken = 0

const generationDraft = reactive({
  imageGenerationMode: 'auto',
  videoGenerationMode: 'auto'
})
const generationSaving = ref(false)

const systemPromptModal = reactive({
  show: false,
  value: '',
  loading: false
})

const contextWindowModal = reactive({
  show: false,
  loading: false
})
const contextWindowDraft = reactive({ ...DEFAULT_CHAT_CONTEXT_WINDOW_CONFIG })
const syncCenterModal = reactive({
  show: false,
  loading: false,
  testing: false,
  testResult: {
    status: 'idle',
    message: ''
  },
  form: {
    enabled: false,
    provider: 'cloud',
    cloud: {
      provider: 'generic_s3',
      region: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucket: '',
      endpoint: '',
      forcePathStyle: false,
      objectPrefix: 'ai-tools-sync',
      allowSelfSignedCertificates: false
    },
    mysql: {
      host: '',
      port: 3306,
      database: '',
      username: '',
      password: ''
    },
    scope: {
      notes: true,
      noteMeta: true,
      config: true,
      sessions: false
    },
    conflictPolicy: 'last_write_wins'
  }
})
const notebookRuntimeDetecting = ref(false)
const detectedNotebookPython = ref('')
const detectedNotebookModules = ref([])
const notebookLspCheck = ref({ ok: false, error: '', pythonPath: '' })
const notebookRuntimeModal = reactive({
  show: false,
  loading: false,
  form: normalizeNotebookRuntimeConfig(noteConfig.value?.notebookRuntime)
})
const notebookDependencyState = reactive({
  installing: false,
  progressMessage: '',
  logs: ''
})
const webSearchConfigDraft = reactive({
  proxyUrl: '',
  allowInsecureTlsFallback: true,
  searchApiProvider: 'none',
  searchApiKey: '',
  searchApiEndpoint: '',
  searchApiMarket: 'zh-CN'
})
const webSearchConfigSaving = ref(false)

const syncActionLoading = reactive({
  backup: false,
  restore: false,
  sync: false
})

const syncActionFeedback = reactive({
  visible: false,
  action: '',
  status: 'idle',
  title: '',
  summary: '',
  detail: '',
  current: 0,
  total: 0
})
const mysqlConflictModal = reactive({
  show: false,
  items: [],
  resolvingKeys: {}
})

const configPasswordModal = reactive({
  show: false,
  mode: 'set',
  loading: false,
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
  recoveryQuestion: '',
  recoveryAnswer: '',
  recoveryAnswerConfirm: ''
})

const securityResetModal = reactive({
  show: false,
  loading: false,
  answer: '',
  newPassword: '',
  confirmPassword: '',
  recoveryQuestion: '',
  recoveryAnswer: '',
  recoveryAnswerConfirm: ''
})

const actionPasswordModal = reactive({
  show: false,
  action: '',
  title: '',
  description: '',
  password: '',
  loading: false
})
const actionPayload = ref(null)

const noteSecurity = computed(() => normalizeNoteSecurityConfig(noteConfig.value?.noteSecurity))
const configSecurity = computed(() => normalizeConfigSecurityState(rawConfigSecurity.value))
const hasConfigPassword = computed(() => !!configSecurity.value.passwordVerifier)
const hasRecoveryQuestion = computed(() => {
  return !!configSecurity.value.recoveryQuestion
    && !!configSecurity.value.recoveryAnswerVerifier
    && !!configSecurity.value.passwordRecoveryEnvelope
})

const dataStorageRootText = computed(() => {
  const text = String(dataStorageRoot.value || '').trim()
  return text || '未设置，文件相关功能会使用插件默认目录。'
})

const detectedNotebookPythonText = computed(() => {
  const text = String(detectedNotebookPython.value || '').trim()
  return text || '未检测到可用 Python，请手动填写解释器路径。'
})
const defaultNotebookVenvRootText = computed(() => getDefaultNotebookVenvRootPath() || '未检测到本机默认目录')
const notebookRuntimeHasConfiguredPython = computed(() => {
  return !!String(notebookRuntimeModal.form?.pythonPath || '').trim()
})
const notebookRuntimeTargetPython = computed(() => {
  const configured = String(notebookRuntimeModal.form?.pythonPath || '').trim()
  return configured || ''
})
const notebookDependencyInstallCommand = computed(() => {
  const pythonPath = String(notebookRuntimeTargetPython.value || '').trim()
  if (!pythonPath) return ''
  return `"${pythonPath}" -m pip install jupyter_client ipykernel jedi-language-server`
})
const notebookDetectedModuleSet = computed(() => {
  return new Set(
    (Array.isArray(detectedNotebookModules.value) ? detectedNotebookModules.value : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )
})
const notebookDependencyItems = computed(() => {
  return NOTEBOOK_REQUIRED_MODULES.map((item) => {
    const installed = notebookDetectedModuleSet.value.has(item.key)
    return {
      ...item,
      installed
    }
  })
})
const notebookMissingDependencyLabels = computed(() => {
  return notebookDependencyItems.value.filter((item) => !item.installed).map((item) => item.label)
})
const notebookDependencyStatus = computed(() => {
  const targetPython = String(notebookRuntimeTargetPython.value || '').trim()
  if (!targetPython) {
    return {
      type: 'default',
      label: '未显示',
      detail: '请先填写 Python 解释器，之后再安装 Notebook 依赖。'
    }
  }
  if (notebookMissingDependencyLabels.value.length === 0 && notebookLspCheck.value.ok) {
    return {
      type: 'success',
      label: '依赖完整',
      detail: '当前解释器已具备 Notebook 执行与补全所需依赖。'
    }
  }
  if (notebookMissingDependencyLabels.value.length === 0) {
    return {
      type: 'warning',
      label: '执行依赖已就绪',
      detail: '核心依赖已安装，但语言服务检查未通过，可继续执行 Notebook，补全功能可能不可用。'
    }
  }
  return {
    type: 'warning',
    label: '缺少依赖',
    detail: `缺少：${notebookMissingDependencyLabels.value.join('、')}。安装只会作用于当前解释器，不会同步到其它设备。`
  }
})
const notebookLspStatus = computed(() => {
  const runtime = normalizeNotebookRuntimeConfig(noteConfig.value?.notebookRuntime)
  const configuredPath = String(runtime.pythonPath || '').trim()
  const effectivePath = configuredPath
  const moduleSet = notebookDetectedModuleSet.value
  const healthError = String(notebookLspCheck.value.error || '').trim().toLowerCase()
  if (!effectivePath) {
    return { type: 'default', label: 'LSP 未配置' }
  }
  if (notebookLspCheck.value.ok) {
    return { type: 'success', label: 'LSP 已启用' }
  }
  if (!moduleSet.has('jedi_language_server') || healthError.includes('no module named jedi_language_server')) {
    return { type: 'warning', label: 'LSP 缺少依赖' }
  }
  return { type: 'warning', label: 'LSP 未启用' }
})
const notebookLspStatusHelp = computed(() => {
  if (notebookLspStatus.value.type === 'success') {
    return '当前状态只根据 Notebook Runtime 配置中的 Python 解释器判断，且已通过语言服务器导入检查。'
  }
  if (notebookLspStatus.value.label === 'LSP 缺少依赖') {
    return '当前 Python 环境缺少 `jedi-language-server`，超级笔记补全不会启用。'
  }
  const healthError = String(notebookLspCheck.value.error || '').trim()
  if (healthError) return `当前状态只根据 Notebook Runtime 配置中的 Python 解释器判断。最近一次检查结果：${healthError}`
  return '当前状态只根据 Notebook Runtime 配置中的 Python 解释器判断。未启用不一定代表缺少依赖，也可能是解释器路径不可用或语言服务器启动失败。'
})

const notebookRuntimeSummary = computed(() => {
  const runtime = normalizeNotebookRuntimeConfig(noteConfig.value?.notebookRuntime)
  const configuredPath = String(runtime.pythonPath || '').trim()
  const configuredVenvRoot = String(runtime.venvRoot || '').trim()
  const detectedPath = String(detectedNotebookPython.value || '').trim()
  const effectivePath = configuredPath && configuredPath.toLowerCase() !== 'python'
    ? configuredPath
    : detectedPath || configuredPath || '未配置'
  const effectiveVenvRoot = configuredVenvRoot || getDefaultNotebookVenvRootPath() || '未配置'
  const pathLabel = configuredPath && configuredPath.toLowerCase() !== 'python'
    ? `Python: ${configuredPath}`
    : detectedPath
      ? `Python: 自动检测 ${detectedPath}`
      : `Python: ${configuredPath || '未配置'}`
  const venvRootLabel = configuredVenvRoot
    ? `Venv: ${configuredVenvRoot}`
    : `Venv: 默认 ${effectiveVenvRoot}`
  const kernelLabel = runtime.kernelName ? `Kernel: ${runtime.kernelName}` : 'Kernel: 默认'
  const startupTimeoutLabel = Number(runtime.startupTimeoutMs) > 0 ? `${runtime.startupTimeoutMs}ms` : '永不超时'
  const executeTimeoutLabel = Number(runtime.executeTimeoutMs) > 0 ? `${runtime.executeTimeoutMs}ms` : '永不超时'
  return `本机本地配置 / ${pathLabel} / ${venvRootLabel} / ${kernelLabel} / 启动 ${startupTimeoutLabel} / 执行 ${executeTimeoutLabel} / 生效解释器 ${effectivePath}`
})

const notebookDependencyStatusLines = computed(() => {
  const targetPython = String(notebookRuntimeTargetPython.value || '').trim()
  if (!targetPython) return []
  const lines = [
    `目标解释器：${targetPython}`,
    notebookDependencyStatus.value.detail,
    '安装操作仅安装到当前电脑上的当前解释器，不会上传、不会同步、不会写入云端。'
  ]
  const lspError = String(notebookLspCheck.value.error || '').trim()
  if (lspError) {
    lines.push(`最近一次检查：${lspError}`)
  }
  return lines
})
const activeCloudProviderPreset = computed(() => {
  const provider = String(syncCenterModal.form.cloud.provider || 'generic_s3').trim()
  return CLOUD_PROVIDER_PRESETS[provider] || CLOUD_PROVIDER_PRESETS.generic_s3
})

const webSearchProxySummary = computed(() => {
  const proxyUrl = String(webSearchConfig.value?.proxyUrl || '').trim()
  const tlsLabel = webSearchConfig.value?.allowInsecureTlsFallback === false ? '证书兜底关闭' : '证书兜底开启'
  const apiProvider = String(webSearchConfig.value?.searchApiProvider || 'none')
  const apiLabel = apiProvider === 'bocha_search'
    ? '博查 API 优先'
    : apiProvider === 'brave_search'
      ? 'Brave API 优先'
      : apiProvider === 'duckduckgo_instant_answer'
        ? 'DuckDuckGo 问答 API 优先'
        : 'HTML 搜索优先'
  return proxyUrl
    ? `当前代理：${proxyUrl} / ${apiLabel} / ${tlsLabel}`
    : `当前直连 / ${apiLabel} / ${tlsLabel}。填写本机 HTTP 代理后，联网搜索会通过代理访问搜索源和网页。`
})

const systemPromptPreview = computed(() => {
  const raw = String(chatConfig.value?.defaultSystemPrompt || '').trim()
  if (!raw) return '未设置，将使用内置默认提示词。'
  return raw.length > 180 ? `${raw.slice(0, 180)}...` : raw
})

const contextWindowSummary = computed(() => {
  const normalized = normalizeChatContextWindowConfig(chatConfig.value?.contextWindow)
  const presetLabel = getContextPresetLabel(normalized.preset)
  const focusLabel = getHistoryFocusLabel(normalized.historyFocus)
  return `${presetLabel} / ${focusLabel} / 最大 ${normalized.maxTurns} 轮，${normalized.maxMessages} 条消息，展开 ${normalized.maxCharsExpanded} 字符，压缩 ${normalized.maxCharsCompact} 字符`
})

const cloudConfigSummary = computed(() => {
  const cfg = cloudConfig.value || {}
  const cloudProvider = String(cfg.provider || syncConfig.value?.cloud?.provider || 'generic_s3').trim()
  const preset = CLOUD_PROVIDER_PRESETS[cloudProvider] || CLOUD_PROVIDER_PRESETS.generic_s3
  const endpoint = String(cfg.endpoint || '').trim()
  const bucket = String(cfg.bucket || '').trim()
  const region = String(cfg.region || '').trim()
  const objectPrefix = String(cfg.objectPrefix || syncConfig.value?.cloud?.objectPrefix || '').trim()
  const tlsLabel = cfg.allowSelfSignedCertificates === true ? '证书：允许自签名' : '证书：严格校验'
  if (!endpoint && !bucket && !region && !objectPrefix) return '未配置云端同步。'
  return [`厂商: ${preset.label}${preset.vendorLabel ? ` ${preset.vendorLabel}` : ''}`, bucket ? `${preset.bucketLabel}: ${bucket}` : '', region ? `Region: ${region}` : '', endpoint ? `Endpoint: ${endpoint}` : '', objectPrefix ? `前缀: ${objectPrefix}` : '', tlsLabel]
    .filter(Boolean)
    .join(' / ')
})

const mysqlSyncSummary = computed(() => {
  const cfg = syncConfig.value || {}
  const mysqlCfg = cfg.mysql || {}
  if (cfg.enabled !== true || cfg.provider !== 'mysql') return '未启用 MySQL 多端同步。'
  const scope = []
  if (cfg.scope?.notes) scope.push('笔记')
  if (cfg.scope?.noteMeta) scope.push('笔记元信息')
  if (cfg.scope?.config) scope.push('配置')
  if (cfg.scope?.sessions) scope.push('会话')
  const policy = cfg.conflictPolicy === 'manual' ? '手动冲突清单' : '最后写入覆盖'
  return [
    `${String(mysqlCfg.host || '').trim() || '-'}:${Number(mysqlCfg.port || 3306) || 3306}`,
    String(mysqlCfg.database || '').trim() || '-',
    scope.length ? `范围：${scope.join(' / ')}` : '未选择同步范围',
    `冲突策略：${policy}`
  ].join(' / ')
})

const syncCenterSummary = computed(() => {
  const cfg = syncConfig.value || {}
  if (cfg.enabled !== true) return '未启用同步，当前不会执行任何同步方式。'
  if (cfg.provider === 'mysql') return `当前方式：MySQL 双端同步 / ${mysqlSyncSummary.value}`
  if (cfg.provider === 'cloud') return `当前方式：云端同步（SQLite 快照） / ${cloudConfigSummary.value || '未配置'}`
  return '已启用同步，但尚未选择同步方式。'
})

const syncSummaryStatusTitle = computed(() => {
  const cfg = syncConfig.value || {}
  if (cfg.enabled !== true) return '同步当前未启用'
  if (cfg.provider === 'mysql') return 'MySQL 双端同步已启用'
  if (cfg.provider === 'cloud') return '云端同步已启用'
  return '同步方式待选择'
})

const syncSummaryStatusDescription = computed(() => {
  const cfg = syncConfig.value || {}
  if (cfg.enabled !== true) {
    return '当前不会执行任何同步动作。打开总开关后，再从云端同步和 MySQL 双端同步中选择一种。'
  }
  if (cfg.provider === 'mysql') {
    return mysqlSyncSummary.value
  }
  if (cfg.provider === 'cloud') {
    return cloudConfigSummary.value
  }
  return '已启用同步，但还没有确定当前的同步方式。'
})

const syncSummaryStatusTagType = computed(() => {
  const cfg = syncConfig.value || {}
  if (cfg.enabled !== true) return 'default'
  return cfg.provider === 'mysql' ? 'success' : 'info'
})

const syncSummaryStatusTagLabel = computed(() => {
  const cfg = syncConfig.value || {}
  if (cfg.enabled !== true) return '未启用'
  return cfg.provider === 'mysql'
    ? 'MySQL 双端同步'
    : cfg.provider === 'cloud'
      ? '云端同步'
      : '待选择'
})

const syncSummaryModeBadge = computed(() => {
  const cfg = syncConfig.value || {}
  if (cfg.provider === 'mysql') return '模式：记录级双向同步'
  if (cfg.provider === 'cloud') return '模式：SQLite 快照同步'
  return '模式：未选择'
})

const syncSummaryStorageBadge = computed(() => {
  const cfg = syncConfig.value || {}
  if (cfg.provider === 'mysql') return '介质：MySQL 数据库'
  if (cfg.provider === 'cloud') {
    const provider = String(cfg.cloud?.provider || cloudConfig.value?.provider || 'generic_s3').trim()
    const preset = CLOUD_PROVIDER_PRESETS[provider] || CLOUD_PROVIDER_PRESETS.generic_s3
    return `介质：${preset.label}${preset.vendorLabel ? ` ${preset.vendorLabel}` : ''}`
  }
  return '介质：未配置'
})

const syncSummaryIsolationBadge = computed(() => '作用域：当前用户隔离')

const syncSummaryDetailItems = computed(() => {
  const cfg = syncConfig.value || {}
  if (cfg.enabled !== true) {
    return [
      '关闭状态下不会上传、拉取或执行双向同步。',
      '已填写的云端或 MySQL 配置会继续保存在本地。'
    ]
  }
  if (cfg.provider === 'mysql') {
    const items = []
    if (cfg.mysql?.host || cfg.mysql?.database) {
      items.push(`连接目标：${String(cfg.mysql?.host || '-').trim() || '-'}:${Number(cfg.mysql?.port || 3306) || 3306} / ${String(cfg.mysql?.database || '-').trim() || '-'}`)
    }
    const scopes = []
    if (cfg.scope?.notes) scopes.push('笔记文件')
    if (cfg.scope?.noteMeta) scopes.push('笔记保护元信息')
    if (cfg.scope?.config) scopes.push('全局配置')
    if (cfg.scope?.sessions) scopes.push('会话文件')
    items.push(scopes.length ? `同步范围：${scopes.join('、')}` : '同步范围：尚未选择任何内容')
    items.push(`冲突策略：${cfg.conflictPolicy === 'manual' ? '手动处理冲突' : '最后写入覆盖'}`)
    return items
  }
  if (cfg.provider === 'cloud') {
    const cloud = cfg.cloud || cloudConfig.value || {}
    const provider = String(cloud.provider || 'generic_s3').trim()
    const preset = CLOUD_PROVIDER_PRESETS[provider] || CLOUD_PROVIDER_PRESETS.generic_s3
    return [
      `厂商类型：${preset.label}${preset.vendorLabel ? ` / ${preset.vendorLabel}` : ''}`,
      `${preset.bucketLabel}：${String(cloud.bucket || '-').trim() || '-'}`,
      `节点区域：${String(cloud.region || '-').trim() || '-'}`,
      `对象前缀：${String(cloud.objectPrefix || 'ai-tools-sync').trim() || 'ai-tools-sync'}`,
      `证书策略：${cloud.allowSelfSignedCertificates === true ? '允许自签名证书' : '严格校验证书'}`
    ]
  }
  return ['请选择一种同步方式后再保存。']
})

const syncActionPercentage = computed(() => {
  const total = Number(syncActionFeedback.total || 0)
  const current = Number(syncActionFeedback.current || 0)
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)))
})

const syncBackupLabel = computed(() => syncConfig.value?.provider === 'mysql' ? '推送到 MySQL' : '上传云端快照')
const syncRunLabel = computed(() => syncConfig.value?.provider === 'mysql' ? '双向同步' : '同步云端快照')
const syncRestoreLabel = computed(() => syncConfig.value?.provider === 'mysql' ? '从 MySQL 拉取' : '从云端恢复')

watch(() => syncCenterModal.form.cloud.provider, (value, previous) => {
  if (!syncCenterModal.show) return
  if (value === previous) return
  applyCloudProviderPreset(value)
})

watch(() => syncCenterModal.form.cloud.region, (value, previous) => {
  if (!syncCenterModal.show) return
  if (value === previous) return
  const currentEndpoint = String(syncCenterModal.form.cloud.endpoint || '').trim()
  const previousExpected = formatCloudProviderEndpoint(syncCenterModal.form.cloud.provider, previous)
  if (!currentEndpoint || currentEndpoint === previousExpected) {
    syncCenterModal.form.cloud.endpoint = formatCloudProviderEndpoint(syncCenterModal.form.cloud.provider, value)
  }
})

const configPasswordSummary = computed(() => {
  if (!hasConfigPassword.value) return '未设置。设置后，进入全局配置页、导入导出配置，以及笔记密码重置都会走同一套校验。'
  return '已设置。修改和清除都必须输入当前密码；忘记密码时可通过安全问题重置。'
})

const configPasswordModalTitle = computed(() => {
  if (configPasswordModal.mode === 'clear') return '清除全局配置密码'
  if (configPasswordModal.mode === 'change') return '修改全局配置密码'
  return '设置全局配置密码'
})

watch(
  () => [chatConfig.value?.imageGenerationMode, chatConfig.value?.videoGenerationMode],
  ([nextImage, nextVideo]) => {
    generationDraft.imageGenerationMode = normalizeGenerationMode(nextImage)
    generationDraft.videoGenerationMode = normalizeGenerationMode(nextVideo)
  },
  { immediate: true }
)

watch(
  () => contextWindowDraft.preset,
  (next, prev) => {
    if (!contextWindowModal.show) return
    if (!next || next === prev || next === 'custom') return
    Object.assign(
      contextWindowDraft,
      normalizeChatContextWindowConfig({
        preset: next,
        historyFocus: contextWindowDraft.historyFocus
      })
    )
  }
)

watch(
  () => webSearchConfig.value,
  (next) => {
    webSearchConfigDraft.proxyUrl = String(next?.proxyUrl || '').trim()
    webSearchConfigDraft.allowInsecureTlsFallback = next?.allowInsecureTlsFallback !== false
    webSearchConfigDraft.searchApiProvider = String(next?.searchApiProvider || 'none')
    webSearchConfigDraft.searchApiKey = String(next?.searchApiKey || '')
    webSearchConfigDraft.searchApiEndpoint = String(next?.searchApiEndpoint || '')
    webSearchConfigDraft.searchApiMarket = String(next?.searchApiMarket || 'zh-CN')
  },
  { immediate: true }
)

void refreshNotebookPythonDetection()

watch(
  () => configSecurity.value.passwordVerifier,
  () => {
    void syncConfigAccessState()
  },
  { immediate: true }
)

function normalizeConfigSecurityState(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    passwordVerifier: src.passwordVerifier || null,
    recoveryQuestion: typeof src.recoveryQuestion === 'string' ? src.recoveryQuestion.trim() : '',
    recoveryAnswerVerifier: src.recoveryAnswerVerifier || null,
    passwordRecoveryEnvelope: typeof src.passwordRecoveryEnvelope === 'string' ? src.passwordRecoveryEnvelope.trim() : ''
  }
}

function normalizeGenerationMode(value) {
  const text = String(value || 'auto').trim().toLowerCase()
  return ['auto', 'on', 'off'].includes(text) ? text : 'auto'
}

function getContextPresetLabel(value) {
  const match = contextWindowPresetOptions.find((item) => item.value === value)
  return match?.label || '平衡'
}

function getHistoryFocusLabel(value) {
  const match = contextWindowHistoryFocusOptions.find((item) => item.value === value)
  return match?.label || '平衡'
}

async function refreshNotebookPythonDetection() {
  notebookRuntimeDetecting.value = true
  try {
    const result = await detectNotebookPython()
    detectedNotebookPython.value = String(result?.pythonPath || result?.path || result || '').trim()
    const runtime = normalizeNotebookRuntimeConfig(noteConfig.value?.notebookRuntime)
    const configuredPath = String(runtime.pythonPath || '').trim()
    const modulePythonPath = configuredPath || 'python'
    if (modulePythonPath) {
      const [moduleResult, lspResult] = await Promise.all([
        listNotebookPythonModules({ pythonPath: modulePythonPath }),
        checkNotebookPythonLsp({ pythonPath: modulePythonPath })
      ])
      detectedNotebookModules.value = Array.isArray(moduleResult?.modules) ? moduleResult.modules : []
      notebookLspCheck.value = {
        ok: !!lspResult?.ok,
        error: String(lspResult?.error || '').trim(),
        pythonPath: String(lspResult?.pythonPath || modulePythonPath).trim()
      }
    } else {
      detectedNotebookModules.value = []
      notebookLspCheck.value = { ok: false, error: '', pythonPath: '' }
    }
  } catch (err) {
    detectedNotebookPython.value = ''
    detectedNotebookModules.value = []
    notebookLspCheck.value = { ok: false, error: '', pythonPath: '' }
    message.error(err?.message || String(err))
  } finally {
    notebookRuntimeDetecting.value = false
  }
}

function resetNotebookDependencyInstallState() {
  notebookDependencyState.installing = false
  notebookDependencyState.progressMessage = ''
  notebookDependencyState.logs = ''
}

function appendNotebookDependencyLog(line) {
  const text = String(line || '').trim()
  if (!text) return
  notebookDependencyState.logs = notebookDependencyState.logs
    ? `${notebookDependencyState.logs}\n${text}`
    : text
}

async function refreshNotebookRuntimeHealth(pythonPath) {
  const targetPythonPath = String(pythonPath || '').trim() || 'python'
  const [moduleResult, lspResult] = await Promise.all([
    listNotebookPythonModules({ pythonPath: targetPythonPath }),
    checkNotebookPythonLsp({ pythonPath: targetPythonPath })
  ])
  detectedNotebookModules.value = Array.isArray(moduleResult?.modules) ? moduleResult.modules : []
  notebookLspCheck.value = {
    ok: !!lspResult?.ok,
    error: String(lspResult?.error || '').trim(),
    pythonPath: String(lspResult?.pythonPath || targetPythonPath).trim()
  }
}

function fillNotebookRuntimeForm(raw = noteConfig.value?.notebookRuntime) {
  notebookRuntimeModal.form = normalizeNotebookRuntimeConfig(raw)
}

function openNotebookRuntimeModal() {
  fillNotebookRuntimeForm(noteConfig.value?.notebookRuntime)
  resetNotebookDependencyInstallState()
  notebookRuntimeModal.show = true
  notebookRuntimeModal.loading = false
}

function closeNotebookRuntimeModal() {
  notebookRuntimeModal.show = false
  notebookRuntimeModal.loading = false
  resetNotebookDependencyInstallState()
}

function handleUseDetectedNotebookPython() {
  const detectedPath = String(detectedNotebookPython.value || '').trim()
  if (!detectedPath) {
    message.warning('当前未检测到可用的 Python 解释器')
    return
  }
  notebookRuntimeModal.form.pythonPath = detectedPath
}

function handlePickNotebookVenvRoot() {
  try {
    const nextPath = openDirectoryDialog()
    if (!nextPath) return
    notebookRuntimeModal.form.venvRoot = nextPath
  } catch (err) {
    message.error(err?.message || String(err))
  }
}

function handleResetNotebookVenvRoot() {
  notebookRuntimeModal.form.venvRoot = ''
}

function isAbsoluteDirectoryPath(input = '') {
  const text = String(input || '').trim()
  if (!text) return false
  return /^[A-Za-z]:[\\/]/.test(text) || /^\\\\/.test(text) || text.startsWith('/')
}

function validateWebSearchProxyUrl(proxyUrl) {
  const text = String(proxyUrl || '').trim()
  if (!text) return ''
  let parsed = null
  try {
    parsed = new URL(text)
  } catch {
    throw new Error('代理地址格式不正确，例如：http://127.0.0.1:7890')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('联网搜索代理目前支持 HTTP/HTTPS 代理，例如：http://127.0.0.1:7890')
  }
  if (!parsed.hostname) {
    throw new Error('代理地址缺少主机名，例如：http://127.0.0.1:7890')
  }
  return parsed.toString().replace(/\/$/, '')
}

function validateWebSearchApiProvider(provider) {
  const text = String(provider || 'none').trim()
  if (webSearchApiProviderOptions.some((item) => item.value === text)) return text
  return 'none'
}

function validateOptionalHttpUrl(input, label) {
  const text = String(input || '').trim()
  if (!text) return ''
  let parsed = null
  try {
    parsed = new URL(text)
  } catch {
    throw new Error(`${label}格式不正确`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label}必须是 HTTP/HTTPS 地址`)
  }
  return parsed.toString()
}

async function saveWebSearchConfig() {
  webSearchConfigSaving.value = true
  try {
    const proxyUrl = validateWebSearchProxyUrl(webSearchConfigDraft.proxyUrl)
    const searchApiProvider = validateWebSearchApiProvider(webSearchConfigDraft.searchApiProvider)
    const searchApiKey = String(webSearchConfigDraft.searchApiKey || '').trim()
    const searchApiEndpoint = validateOptionalHttpUrl(webSearchConfigDraft.searchApiEndpoint, '搜索 API Endpoint')
    const searchApiMarket = String(webSearchConfigDraft.searchApiMarket || '').trim() || 'zh-CN'
    if ((searchApiProvider === 'bocha_search' || searchApiProvider === 'brave_search') && !searchApiKey) {
      throw new Error(searchApiProvider === 'bocha_search' ? '使用博查搜索 API 时需要填写 API Key' : '使用 Brave Search API 时需要填写 API Key')
    }
    await updateWebSearchConfig({
      proxyUrl,
      allowInsecureTlsFallback: webSearchConfigDraft.allowInsecureTlsFallback !== false,
      searchApiProvider,
      searchApiKey: searchApiProvider === 'bocha_search' || searchApiProvider === 'brave_search' ? searchApiKey : '',
      searchApiEndpoint: searchApiProvider === 'bocha_search' || searchApiProvider === 'brave_search' ? searchApiEndpoint : '',
      searchApiMarket
    })
    webSearchConfigDraft.proxyUrl = proxyUrl
    webSearchConfigDraft.searchApiProvider = searchApiProvider
    webSearchConfigDraft.searchApiKey = searchApiProvider === 'bocha_search' || searchApiProvider === 'brave_search' ? searchApiKey : ''
    webSearchConfigDraft.searchApiEndpoint = searchApiProvider === 'bocha_search' || searchApiProvider === 'brave_search' ? searchApiEndpoint : ''
    webSearchConfigDraft.searchApiMarket = searchApiMarket
    message.success(proxyUrl ? '联网搜索设置已保存到当前电脑本地' : '联网搜索已改为直连')
  } catch (err) {
    message.error(err?.message || String(err))
  } finally {
    webSearchConfigSaving.value = false
  }
}

async function saveNotebookRuntimeConfig() {
  notebookRuntimeModal.loading = true
  try {
    const normalized = normalizeNotebookRuntimeConfig(notebookRuntimeModal.form)
    if (normalized.venvRoot && !isAbsoluteDirectoryPath(normalized.venvRoot)) {
      throw new Error('虚拟环境存储目录必须填写绝对路径，或留空使用默认目录。')
    }
    await updateNoteConfig({
      notebookRuntime: normalized
    })
    try {
      const pythonPath = String(normalized.pythonPath || '').trim() || 'python'
      await refreshNotebookRuntimeHealth(pythonPath)
    } catch {
      detectedNotebookModules.value = []
      notebookLspCheck.value = { ok: false, error: '', pythonPath: '' }
    }
    fillNotebookRuntimeForm(normalized)
    closeNotebookRuntimeModal()
    message.success('Notebook Runtime 配置已保存到当前电脑本地')
  } catch (err) {
    message.error(err?.message || String(err))
  } finally {
    notebookRuntimeModal.loading = false
  }
}

async function installNotebookRuntimeDependencies() {
  const normalized = normalizeNotebookRuntimeConfig(notebookRuntimeModal.form)
  const pythonPath = String(normalized.pythonPath || '').trim()
  if (!pythonPath) {
    message.warning('请先填写或选择 Python 解释器')
    return
  }

  notebookDependencyState.installing = true
  notebookDependencyState.progressMessage = '正在准备安装 Notebook 依赖...'
  notebookDependencyState.logs = ''
  try {
    await installNotebookDependencies({
      pythonPath,
      onProgress: (progress) => {
        const summary = String(progress?.message || progress?.text || '').trim()
        if (summary) {
          notebookDependencyState.progressMessage = summary
          appendNotebookDependencyLog(summary)
        }
      }
    })
    notebookDependencyState.progressMessage = '依赖安装完成，正在刷新状态...'
    appendNotebookDependencyLog('依赖安装完成，开始重新检测当前解释器状态。')
    await refreshNotebookRuntimeHealth(pythonPath)
    notebookDependencyState.progressMessage = '依赖安装完成'
    message.success('Notebook 依赖已安装到当前解释器')
  } catch (err) {
    notebookDependencyState.progressMessage = '依赖安装失败'
    appendNotebookDependencyLog(err?.message || String(err))
    message.error(err?.message || String(err))
  } finally {
    notebookDependencyState.installing = false
  }
}

function getUtoolsApi() {
  return window?.utools || globalThis?.utools
}

function extractDialogPath(entry) {
  if (!entry) return ''
  if (typeof entry === 'string') return entry.trim()
  if (typeof entry === 'object') {
    const candidates = [entry.path, entry.filePath, entry.fullPath, entry.value]
    for (const candidate of candidates) {
      const text = typeof candidate === 'string' ? candidate.trim() : ''
      if (text) return text
    }
  }
  return ''
}

function resolveOpenDialogPath(result) {
  if (!result) return ''
  if (Array.isArray(result)) return extractDialogPath(result[0])
  if (typeof result === 'object' && Array.isArray(result.filePaths)) return extractDialogPath(result.filePaths[0])
  return extractDialogPath(result)
}

function resolveSaveDialogPath(result) {
  if (!result) return ''
  if (typeof result === 'string') return result.trim()
  if (typeof result === 'object') return extractDialogPath(result)
  return ''
}

function openDirectoryDialog() {
  const api = getUtoolsApi()
  if (!api?.showOpenDialog) throw new Error('当前环境不支持目录选择。')
  return resolveOpenDialogPath(api.showOpenDialog({ properties: ['openDirectory'] }))
}

function getDefaultNotebookVenvRootPath() {
  const userDataRoot = String(getUtoolsApi()?.getPath?.('userData') || '').trim()
  if (!userDataRoot) return ''
  const trimmed = userDataRoot.replace(/[\\/]+$/, '')
  const useBackslash = trimmed.includes('\\')
  return useBackslash
    ? `${trimmed}\\.ai-tools-local\\venv`
    : `${trimmed}/.ai-tools-local/venv`
}

function openFileDialog() {
  const api = getUtoolsApi()
  if (!api?.showOpenDialog) throw new Error('当前环境不支持文件选择。')
  return resolveOpenDialogPath(
    api.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
  )
}

function saveFileDialog() {
  const api = getUtoolsApi()
  if (!api?.showSaveDialog) throw new Error('当前环境不支持保存文件对话框。')
  return resolveSaveDialogPath(
    api.showSaveDialog({
      title: '导出全局配置',
      defaultPath: 'ai-tools-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
  )
}

function getSessionPassword() {
  const host = typeof window !== 'undefined' ? window : globalThis
  return String(host?.[CONFIG_ACCESS_SESSION_KEY] || '')
}

function setSessionPassword(password) {
  const text = String(password || '')
  globalThis[CONFIG_ACCESS_SESSION_KEY] = text
  if (typeof window !== 'undefined') window[CONFIG_ACCESS_SESSION_KEY] = text
}

function clearSessionPassword() {
  try {
    delete globalThis[CONFIG_ACCESS_SESSION_KEY]
  } catch {
    globalThis[CONFIG_ACCESS_SESSION_KEY] = ''
  }
  if (typeof window !== 'undefined') {
    try {
      delete window[CONFIG_ACCESS_SESSION_KEY]
    } catch {
      window[CONFIG_ACCESS_SESSION_KEY] = ''
    }
  }
}

async function syncConfigAccessState() {
  const token = ++accessSyncToken
  configAccessReady.value = false

  if (!hasConfigPassword.value) {
    clearSessionPassword()
    configPageUnlocked.value = true
    configAccessReady.value = true
    return
  }

  const cachedPassword = getSessionPassword()
  if (!cachedPassword) {
    configPageUnlocked.value = false
    configAccessReady.value = true
    return
  }

  try {
    const ok = await verifyPassword(cachedPassword, configSecurity.value.passwordVerifier)
    if (token !== accessSyncToken) return
    if (ok) {
      configPageUnlocked.value = true
    } else {
      clearSessionPassword()
      configPageUnlocked.value = false
    }
  } catch {
    clearSessionPassword()
    configPageUnlocked.value = false
  } finally {
    if (token === accessSyncToken) configAccessReady.value = true
  }
}

async function submitPageUnlock() {
  const password = String(pageUnlockPassword.value || '')
  if (!password) {
    message.warning('请输入全局配置密码')
    return
  }

  pageUnlockLoading.value = true
  try {
    const ok = await verifyPassword(password, configSecurity.value.passwordVerifier)
    if (!ok) {
      message.error('全局配置密码错误')
      return
    }
    setSessionPassword(password)
    configPageUnlocked.value = true
    configAccessReady.value = true
    pageUnlockPassword.value = ''
  } catch (err) {
    message.error(err?.message || String(err))
  } finally {
    pageUnlockLoading.value = false
  }
}

function cloneProtectedNotesMap() {
  const out = {}
  Object.entries(noteSecurity.value.protectedNotes || {}).forEach(([notePath, meta]) => {
    out[notePath] = { ...meta }
  })
  return out
}

async function assertCurrentConfigPassword(password) {
  const text = String(password || '')
  if (!text) throw new Error('请输入当前全局配置密码')
  const ok = await verifyPassword(text, configSecurity.value.passwordVerifier)
  if (!ok) throw new Error('当前全局配置密码错误')
  return text
}

async function buildConfigSecurityPayload(password, recoveryQuestion, recoveryAnswer) {
  const nextPassword = String(password || '')
  const question = String(recoveryQuestion || '').trim()
  const answer = String(recoveryAnswer || '')

  if (!nextPassword) throw new Error('新的全局配置密码不能为空')
  if (!question) throw new Error('安全问题不能为空')
  if (!answer) throw new Error('安全问题答案不能为空')

  return {
    passwordVerifier: await createPasswordVerifier(nextPassword),
    recoveryQuestion: question,
    recoveryAnswerVerifier: await createPasswordVerifier(answer),
    passwordRecoveryEnvelope: await encryptTextWithPassword(nextPassword, answer)
  }
}

async function rollbackNoteRewrites(writtenEntries) {
  for (let i = writtenEntries.length - 1; i >= 0; i -= 1) {
    const item = writtenEntries[i]
    try {
      await writeFile(item.notePath, item.originalRaw)
    } catch (err) {
      console.error('[Config] failed to rollback protected note rewrite', item.notePath, err)
    }
  }
}

async function prepareFallbackMigration(currentPassword, nextPassword) {
  const nextProtectedNotes = cloneProtectedNotesMap()
  const rewrites = []
  const now = new Date().toISOString()

  for (const [notePath, meta] of Object.entries(nextProtectedNotes)) {
    if (!meta?.hasFallbackRecovery) continue

    const raw = String(await readFile(notePath, 'utf-8') || '')
    if (!hasFallbackRecovery(raw)) {
      nextProtectedNotes[notePath] = {
        ...meta,
        hasFallbackRecovery: false
      }
      continue
    }

    const nextRaw = await changeFallbackPassword(raw, {
      currentFallbackPassword: currentPassword,
      newFallbackPassword: nextPassword
    })

    rewrites.push({
      notePath,
      originalRaw: raw,
      nextRaw
    })

    nextProtectedNotes[notePath] = {
      ...meta,
      updatedAt: now,
      hasFallbackRecovery: !!nextPassword
    }
  }

  return { nextProtectedNotes, rewrites }
}

async function applyConfigPasswordTransition(options = {}) {
  const clearPassword = !!options.clearPassword
  const currentPassword = String(options.currentPassword || '')
  const nextPassword = String(options.newPassword || '')
  const nextConfigSecurity = clearPassword ? { ...EMPTY_CONFIG_SECURITY } : { ...(options.nextConfigSecurity || EMPTY_CONFIG_SECURITY) }
  const baseNoteSecurity = noteSecurity.value
  const migration = hasConfigPassword.value
    ? await prepareFallbackMigration(currentPassword, clearPassword ? '' : nextPassword)
    : { nextProtectedNotes: cloneProtectedNotesMap(), rewrites: [] }

  const writtenEntries = []
  try {
    for (const item of migration.rewrites) {
      if (item.originalRaw === item.nextRaw) continue
      await writeFile(item.notePath, item.nextRaw)
      writtenEntries.push(item)
    }
  } catch (err) {
    await rollbackNoteRewrites(writtenEntries)
    throw err
  }

  try {
    await updateGlobalConfig({
      noteConfig: {
        noteSecurity: {
          ...baseNoteSecurity,
          protectedNotes: migration.nextProtectedNotes
        }
      },
      configSecurity: nextConfigSecurity
    })
  } catch (err) {
    await rollbackNoteRewrites(writtenEntries)
    throw err
  }

  if (clearPassword) {
    clearSessionPassword()
  } else {
    setSessionPassword(nextPassword)
  }
  configPageUnlocked.value = true
  configAccessReady.value = true
  pageUnlockPassword.value = ''
}

async function handleToggleTheme() {
  try {
    await cutTheme()
  } catch (err) {
    message.error(err?.message || String(err))
  }
}

async function handlePickDataStorageRoot() {
  try {
    const nextPath = openDirectoryDialog()
    if (!nextPath) return
    await setDataStorageRoot(nextPath)
    message.success('数据存储根目录已更新')
  } catch (err) {
    message.error(describeFileOperationsError(err, '设置数据存储根目录'))
  }
}

async function handleResetDataStorageRoot() {
  try {
    await resetDataStorageRoot()
    message.success('数据存储根目录已恢复默认')
  } catch (err) {
    message.error(describeFileOperationsError(err, '重置数据存储根目录'))
  }
}

function openSystemPromptModal() {
  systemPromptModal.show = true
  systemPromptModal.value = String(chatConfig.value?.defaultSystemPrompt || '')
  systemPromptModal.loading = false
}

function closeSystemPromptModal() {
  systemPromptModal.show = false
  systemPromptModal.value = ''
  systemPromptModal.loading = false
}

async function saveSystemPrompt() {
  systemPromptModal.loading = true
  try {
    await updateChatConfig({
      defaultSystemPrompt: String(systemPromptModal.value || '')
    })
    closeSystemPromptModal()
    message.success('默认系统提示词已保存')
  } catch (err) {
    message.error(err?.message || String(err))
  } finally {
    systemPromptModal.loading = false
  }
}

async function saveGenerationModes() {
  generationSaving.value = true
  try {
    await updateChatConfig({
      imageGenerationMode: normalizeGenerationMode(generationDraft.imageGenerationMode),
      videoGenerationMode: normalizeGenerationMode(generationDraft.videoGenerationMode)
    })
    message.success('生成模式已保存')
  } catch (err) {
    message.error(err?.message || String(err))
  } finally {
    generationSaving.value = false
  }
}

function syncContextWindowDraft(raw = chatConfig.value?.contextWindow) {
  Object.assign(contextWindowDraft, normalizeChatContextWindowConfig(raw))
}

function openContextWindowModal() {
  syncContextWindowDraft(chatConfig.value?.contextWindow)
  contextWindowModal.show = true
  contextWindowModal.loading = false
}

function closeContextWindowModal() {
  contextWindowModal.show = false
  contextWindowModal.loading = false
}

async function saveContextWindow() {
  contextWindowModal.loading = true
  try {
    const normalized = normalizeChatContextWindowConfig({ ...contextWindowDraft })
    await updateChatConfig({ contextWindow: normalized })
    closeContextWindowModal()
    message.success('上下文窗口策略已保存')
  } catch (err) {
    message.error(err?.message || String(err))
  } finally {
    contextWindowModal.loading = false
  }
}

function fillSyncCenterForm(raw = syncConfig.value, cloudRaw = cloudConfig.value) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const cloud = src.cloud && typeof src.cloud === 'object' ? src.cloud : (cloudRaw && typeof cloudRaw === 'object' ? cloudRaw : {})
  const mysql = src.mysql && typeof src.mysql === 'object' ? src.mysql : {}
  const scope = src.scope && typeof src.scope === 'object' ? src.scope : {}
  syncCenterModal.form.enabled = src.enabled === true
  syncCenterModal.form.provider = String(src.provider || 'cloud') || 'cloud'
  syncCenterModal.form.cloud.provider = String(cloud.provider || 'generic_s3') || 'generic_s3'
  syncCenterModal.form.cloud.region = String(cloud.region || '')
  syncCenterModal.form.cloud.accessKeyId = String(cloud.accessKeyId || '')
  syncCenterModal.form.cloud.secretAccessKey = String(cloud.secretAccessKey || '')
  syncCenterModal.form.cloud.bucket = String(cloud.bucket || '')
  syncCenterModal.form.cloud.endpoint = String(cloud.endpoint || '')
  syncCenterModal.form.cloud.forcePathStyle = cloud.forcePathStyle === true
  syncCenterModal.form.cloud.objectPrefix = String(cloud.objectPrefix || 'ai-tools-sync')
  syncCenterModal.form.cloud.allowSelfSignedCertificates = cloud.allowSelfSignedCertificates === true
  syncCenterModal.form.mysql.host = String(mysql.host || '')
  syncCenterModal.form.mysql.port = Number(mysql.port || 3306) || 3306
  syncCenterModal.form.mysql.database = String(mysql.database || '')
  syncCenterModal.form.mysql.username = String(mysql.username || '')
  syncCenterModal.form.mysql.password = String(mysql.password || '')
  syncCenterModal.form.scope.notes = scope.notes !== false
  syncCenterModal.form.scope.noteMeta = scope.noteMeta !== false
  syncCenterModal.form.scope.config = scope.config !== false
  syncCenterModal.form.scope.sessions = scope.sessions === true
  syncCenterModal.form.conflictPolicy = String(src.conflictPolicy || 'last_write_wins') || 'last_write_wins'
}

function formatCloudProviderEndpoint(provider, region) {
  const preset = CLOUD_PROVIDER_PRESETS[String(provider || 'generic_s3').trim()] || CLOUD_PROVIDER_PRESETS.generic_s3
  const normalizedRegion = String(region || '').trim()
  if (!normalizedRegion) return ''
  return preset.endpointTemplate.replace('{region}', normalizedRegion)
}

function applyCloudProviderPreset(provider, options = {}) {
  const nextProvider = String(provider || 'generic_s3').trim()
  const preset = CLOUD_PROVIDER_PRESETS[nextProvider] || CLOUD_PROVIDER_PRESETS.generic_s3
  const shouldAutofillEndpoint = options.force === true || !String(syncCenterModal.form.cloud.endpoint || '').trim()
  syncCenterModal.form.cloud.provider = nextProvider
  syncCenterModal.form.cloud.forcePathStyle = preset.forcePathStyle === true
  if (shouldAutofillEndpoint) {
    syncCenterModal.form.cloud.endpoint = formatCloudProviderEndpoint(nextProvider, syncCenterModal.form.cloud.region)
  }
}

function openSyncCenterModal() {
  fillSyncCenterForm(syncConfig.value, cloudConfig.value)
  applyCloudProviderPreset(syncCenterModal.form.cloud.provider)
  syncCenterModal.show = true
  syncCenterModal.loading = false
  syncCenterModal.testing = false
  syncCenterModal.testResult.status = 'idle'
  syncCenterModal.testResult.message = ''
}

function closeSyncCenterModal() {
  syncCenterModal.show = false
  syncCenterModal.loading = false
  syncCenterModal.testing = false
  syncCenterModal.testResult.status = 'idle'
  syncCenterModal.testResult.message = ''
}

async function saveSyncCenterConfig() {
  syncCenterModal.loading = true
  try {
    const provider = syncCenterModal.form.provider === 'mysql' ? 'mysql' : 'cloud'
    await updateSyncConfig({
      enabled: syncCenterModal.form.enabled === true,
      provider,
      cloud: {
        provider: syncCenterModal.form.cloud.provider,
        region: syncCenterModal.form.cloud.region.trim(),
        accessKeyId: syncCenterModal.form.cloud.accessKeyId.trim(),
        secretAccessKey: String(syncCenterModal.form.cloud.secretAccessKey || ''),
        bucket: syncCenterModal.form.cloud.bucket.trim(),
        endpoint: syncCenterModal.form.cloud.endpoint.trim(),
        forcePathStyle: syncCenterModal.form.cloud.forcePathStyle === true,
        objectPrefix: syncCenterModal.form.cloud.objectPrefix.trim() || 'ai-tools-sync',
        allowSelfSignedCertificates: syncCenterModal.form.cloud.allowSelfSignedCertificates === true
      },
      mysql: {
        host: syncCenterModal.form.mysql.host.trim(),
        port: Number(syncCenterModal.form.mysql.port || 3306) || 3306,
        database: syncCenterModal.form.mysql.database.trim(),
        username: syncCenterModal.form.mysql.username.trim(),
        password: String(syncCenterModal.form.mysql.password || '')
      },
      scope: {
        notes: syncCenterModal.form.scope.notes !== false,
        noteMeta: syncCenterModal.form.scope.noteMeta !== false,
        config: syncCenterModal.form.scope.config !== false,
        sessions: syncCenterModal.form.scope.sessions === true
      },
      conflictPolicy: syncCenterModal.form.conflictPolicy === 'manual' ? 'manual' : 'last_write_wins'
    })
    if (provider === 'cloud') {
      await updateCloudConfig({
        provider: syncCenterModal.form.cloud.provider,
        region: syncCenterModal.form.cloud.region.trim(),
        accessKeyId: syncCenterModal.form.cloud.accessKeyId.trim(),
        secretAccessKey: String(syncCenterModal.form.cloud.secretAccessKey || ''),
        bucket: syncCenterModal.form.cloud.bucket.trim(),
        endpoint: syncCenterModal.form.cloud.endpoint.trim(),
        forcePathStyle: syncCenterModal.form.cloud.forcePathStyle === true
      })
    }
    closeSyncCenterModal()
    message.success('同步中心配置已保存')
  } catch (err) {
    message.error(err?.message || String(err))
  } finally {
    syncCenterModal.loading = false
  }
}

async function handleTestSyncProvider() {
  syncCenterModal.testing = true
  syncCenterModal.testResult.status = 'idle'
  syncCenterModal.testResult.message = ''
  try {
    const provider = syncCenterModal.form.provider === 'mysql' ? 'mysql' : 'cloud'
    const result = await testUnifiedSync(provider, {
      enabled: true,
      provider,
      cloud: {
        provider: syncCenterModal.form.cloud.provider,
        region: syncCenterModal.form.cloud.region.trim(),
        accessKeyId: syncCenterModal.form.cloud.accessKeyId.trim(),
        secretAccessKey: String(syncCenterModal.form.cloud.secretAccessKey || ''),
        bucket: syncCenterModal.form.cloud.bucket.trim(),
        endpoint: syncCenterModal.form.cloud.endpoint.trim(),
        forcePathStyle: syncCenterModal.form.cloud.forcePathStyle === true,
        objectPrefix: syncCenterModal.form.cloud.objectPrefix.trim() || 'ai-tools-sync',
        allowSelfSignedCertificates: syncCenterModal.form.cloud.allowSelfSignedCertificates === true
      },
      mysql: {
        host: syncCenterModal.form.mysql.host.trim(),
        port: Number(syncCenterModal.form.mysql.port || 3306) || 3306,
        database: syncCenterModal.form.mysql.database.trim(),
        username: syncCenterModal.form.mysql.username.trim(),
        password: String(syncCenterModal.form.mysql.password || '')
      },
      scope: {
        notes: syncCenterModal.form.scope.notes !== false,
        noteMeta: syncCenterModal.form.scope.noteMeta !== false,
        config: syncCenterModal.form.scope.config !== false,
        sessions: syncCenterModal.form.scope.sessions === true
      },
      conflictPolicy: syncCenterModal.form.conflictPolicy === 'manual' ? 'manual' : 'last_write_wins'
    })
    syncCenterModal.testResult.status = 'success'
    if (provider === 'mysql') {
      const databaseCreated = result?.provisioning?.database?.created === true
      const tableInfo = result?.provisioning?.tables || {}
      const createdTables = Object.values(tableInfo).filter((item) => item?.created === true).length
      const summaryParts = [
        `MySQL 连接成功`,
        result?.database ? `数据库 ${result.database}` : '',
        result?.userId ? `用户隔离 ${result.userId}` : '',
        databaseCreated ? '已自动创建数据库' : '数据库已存在',
        createdTables > 0 ? `已补齐 ${createdTables} 张同步表` : '同步表已就绪'
      ].filter(Boolean)
      syncCenterModal.testResult.message = `${summaryParts.join('，')}。`
    } else {
      const preset = activeCloudProviderPreset.value
      syncCenterModal.testResult.message = `${preset.label}${preset.vendorLabel ? ` ${preset.vendorLabel}` : ''} 连接成功，可直接保存当前配置。`
    }
    message.success(provider === 'mysql' ? 'MySQL 连接测试成功' : '云端连接测试成功')
  } catch (err) {
    syncCenterModal.testResult.status = 'error'
    syncCenterModal.testResult.message = describeFileOperationsError(err, syncCenterModal.form.provider === 'mysql' ? '测试 MySQL 同步连接' : '测试云端同步连接')
    message.error(describeFileOperationsError(err, syncCenterModal.form.provider === 'mysql' ? '测试 MySQL 同步连接' : '测试云端同步连接'))
  } finally {
    syncCenterModal.testing = false
  }
}

function getSyncActionLabel(action) {
  const provider = syncConfig.value?.provider === 'mysql' ? 'mysql' : 'cloud'
  if (provider === 'mysql') {
    if (action === 'backup') return '执行 MySQL 推送'
    if (action === 'sync') return '执行 MySQL 双端同步'
    return '执行 MySQL 拉取'
  }
  if (action === 'backup') return '执行云端快照上传'
  if (action === 'sync') return '执行云端快照同步'
  return '执行云端快照恢复'
}

function beginSyncActionFeedback(action) {
  const provider = syncConfig.value?.provider === 'mysql' ? 'mysql' : 'cloud'
  syncActionFeedback.visible = true
  syncActionFeedback.action = action
  syncActionFeedback.status = 'running'
  syncActionFeedback.title = `${getSyncActionLabel(action)}进行中`
  syncActionFeedback.summary = '正在准备同步数据...'
  syncActionFeedback.detail = provider === 'mysql'
    ? (action === 'sync'
      ? '当前仅执行 MySQL 双端同步，会比较本地与 MySQL 的更新时间，按冲突策略决定推送、拉取或返回冲突清单。'
      : action === 'backup'
        ? '当前仅执行 MySQL 推送，会把当前用户的数据写入 MySQL。'
        : '当前仅执行 MySQL 拉取，会把 MySQL 中当前用户的数据写回本地。')
    : (action === 'sync'
      ? '当前仅执行云端同步，会比较本地 SQLite 快照与云端快照的更新时间，自动决定上传或下载。'
      : action === 'backup'
        ? '当前仅执行云端上传，会将当前用户数据打包为 SQLite 快照并上传到云端。'
        : '当前仅执行云端恢复，会下载云端 SQLite 快照并恢复当前用户数据。')
  syncActionFeedback.current = 0
  syncActionFeedback.total = 0
}

function updateSyncActionFeedback(action, current, total) {
  const nextCurrent = Math.max(0, Number(current) || 0)
  const nextTotal = Math.max(nextCurrent, Number(total) || 0)
  syncActionFeedback.visible = true
  syncActionFeedback.action = action
  syncActionFeedback.status = 'running'
  syncActionFeedback.title = `${getSyncActionLabel(action)}进行中`
  syncActionFeedback.current = nextCurrent
  syncActionFeedback.total = nextTotal
  syncActionFeedback.summary = nextTotal > 0 ? `已处理 ${nextCurrent} / ${nextTotal} 项` : '正在准备同步数据...'
  syncActionFeedback.detail = syncConfig.value?.provider === 'mysql'
    ? '当前只会按 MySQL 双端同步方式执行，同步范围受当前 scope 开关控制。'
    : '当前只会按云端同步方式执行，快照范围受当前 scope 开关控制。'
}

function formatMysqlConflictSummary(result) {
  const conflicts = Array.isArray(result?.conflicts) ? result.conflicts : []
  if (!conflicts.length) return ''
  const preview = conflicts.slice(0, 5).map((item) => `${item.type}:${item.key}`).join('；')
  return conflicts.length > 5 ? `${preview}；其余 ${conflicts.length - 5} 项待手动处理。` : `${preview}。`
}

function formatMysqlConflictTime(value) {
  const text = String(value || '').trim()
  if (!text) return '未知'
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString('zh-CN', { hour12: false })
}

function formatMysqlConflictHash(value) {
  const text = String(value || '').trim()
  if (!text) return '-'
  return text.length > 16 ? `${text.slice(0, 8)}...${text.slice(-8)}` : text
}

function getMysqlConflictTypeLabel(type) {
  if (type === 'note') return '笔记'
  if (type === 'session') return '会话'
  return '配置'
}

function getMysqlConflictTypeTag(type) {
  if (type === 'note') return 'warning'
  if (type === 'session') return 'info'
  return 'error'
}

function openMysqlConflictModal() {
  if (!mysqlConflictModal.items.length) {
    message.warning('当前没有可查看的冲突项')
    return
  }
  mysqlConflictModal.show = true
}

function clearMysqlConflictModal() {
  mysqlConflictModal.items = []
  mysqlConflictModal.resolvingKeys = {}
  mysqlConflictModal.show = false
}

function getMysqlConflictResolveKey(item, resolution) {
  return `${item?.type || ''}:${item?.key || ''}:${resolution}`
}

function isMysqlConflictResolving(item, resolution) {
  return mysqlConflictModal.resolvingKeys[getMysqlConflictResolveKey(item, resolution)] === true
}

async function handleMysqlConflictResolution(item, resolution) {
  const resolveKey = getMysqlConflictResolveKey(item, resolution)
  if (mysqlConflictModal.resolvingKeys[resolveKey]) return

  mysqlConflictModal.resolvingKeys[resolveKey] = true
  try {
    await resolveMysqlConflict({
      type: item.type,
      key: item.type === 'config' ? 'config' : item.key,
      resolution
    })

    mysqlConflictModal.items = mysqlConflictModal.items.filter((entry) => !(entry.type === item.type && entry.key === item.key))

    if (!mysqlConflictModal.items.length) {
      syncActionFeedback.visible = true
      syncActionFeedback.action = 'sync'
      syncActionFeedback.status = 'success'
      syncActionFeedback.title = 'MySQL 冲突已处理'
      syncActionFeedback.summary = '当前冲突项已全部处理完成。'
      syncActionFeedback.detail = '如需确认结果，可再次执行一次 MySQL 双端同步。'
      mysqlConflictModal.show = false
    } else {
      syncActionFeedback.visible = true
      syncActionFeedback.action = 'sync'
      syncActionFeedback.status = 'error'
      syncActionFeedback.title = 'MySQL 冲突处理中'
      syncActionFeedback.summary = `剩余 ${mysqlConflictModal.items.length} 项冲突待处理。`
      syncActionFeedback.detail = '可继续逐项选择保留本地或保留远端。'
    }

    message.success(resolution === 'local' ? '已保留本地版本' : '已保留远端版本')
  } catch (err) {
    message.error(describeFileOperationsError(err, '处理 MySQL 冲突'))
  } finally {
    delete mysqlConflictModal.resolvingKeys[resolveKey]
  }
}

function buildSyncActionSuccessSummary(action, result) {
  if (syncConfig.value?.provider === 'cloud') {
    if (action === 'backup') return `已上传 1 个 SQLite 快照。`
    if (action === 'restore') return `已恢复 1 个 SQLite 快照。`
    if (result?.direction === 'download') return '已从云端下载并恢复最新 SQLite 快照。'
    if (result?.direction === 'upload') return '已将本地最新 SQLite 快照上传到云端。'
    return '本地与云端快照已一致，无需变更。'
  }
  if (action === 'backup') {
    return `notes ${Number(result?.notes || 0)} / config ${Number(result?.config || 0)} / sessions ${Number(result?.sessions || 0)}`
  }
  if (action === 'restore') {
    return `notes ${Number(result?.notes || 0)} / config ${Number(result?.config || 0)} / sessions ${Number(result?.sessions || 0)}`
  }
  return [
    `变更 ${Number(result?.notes || 0) + Number(result?.config || 0) + Number(result?.sessions || 0)}`,
    `推送 notes ${Number(result?.pushed?.notes || 0)} / config ${Number(result?.pushed?.config || 0)} / sessions ${Number(result?.pushed?.sessions || 0)}`,
    `拉取 notes ${Number(result?.pulled?.notes || 0)} / config ${Number(result?.pulled?.config || 0)} / sessions ${Number(result?.pulled?.sessions || 0)}`
  ].join(' / ')
}

async function handleSyncAction(action) {
  beginSyncActionFeedback(action)
  syncActionLoading[action] = true
  try {
    const progressCallback = (current, total) => {
      updateSyncActionFeedback(action, current, total)
    }
    const provider = syncConfig.value?.provider === 'mysql' ? 'mysql' : 'cloud'
    let result
    if (action === 'backup') result = await backupSync(provider, progressCallback)
    else if (action === 'sync') result = await runSync(provider, progressCallback)
    else result = await restoreSync(provider, progressCallback)

    if (provider === 'mysql' && action === 'sync' && result?.ok === false && Array.isArray(result?.conflicts) && result.conflicts.length) {
      const summary = `检测到 ${result.conflicts.length} 项冲突，未自动覆盖。`
      mysqlConflictModal.items = result.conflicts.map((item) => ({ ...item }))
      syncActionFeedback.visible = true
      syncActionFeedback.action = action
      syncActionFeedback.status = 'error'
      syncActionFeedback.title = `${getSyncActionLabel(action)}需要手动处理`
      syncActionFeedback.summary = summary
      syncActionFeedback.detail = `${formatMysqlConflictSummary(result)} 可点击“查看冲突详情”查看完整列表。`
      syncActionFeedback.current = Math.max(syncActionFeedback.current, syncActionFeedback.total)
      message.warning(summary)
      return
    }

    if (provider === 'mysql' && action === 'sync' && result?.ok === true) {
      mysqlConflictModal.items = []
    }

    syncActionFeedback.visible = true
    syncActionFeedback.action = action
    syncActionFeedback.status = 'success'
    syncActionFeedback.title = `${getSyncActionLabel(action)}已完成`
    syncActionFeedback.summary = buildSyncActionSuccessSummary(action, result)
    syncActionFeedback.detail = provider === 'mysql'
      ? (action === 'sync' ? '本次仅执行了 MySQL 双端同步，当前用户的数据已按冲突策略完成收敛。' : '本次仅执行了 MySQL 同步操作。')
      : (action === 'sync' ? '本次仅执行了云端同步，当前用户的 SQLite 快照已与云端完成收敛。' : '本次仅执行了云端快照操作。')
    syncActionFeedback.current = Math.max(syncActionFeedback.current, syncActionFeedback.total)
    message.success(syncActionFeedback.summary)
  } catch (err) {
    const label = getSyncActionLabel(action)
    const errorText = describeFileOperationsError(err, label)
    syncActionFeedback.visible = true
    syncActionFeedback.action = action
    syncActionFeedback.status = 'error'
    syncActionFeedback.title = `${label}失败`
    syncActionFeedback.summary = errorText
    syncActionFeedback.detail = ''
    message.error(errorText)
  } finally {
    syncActionLoading[action] = false
  }
}

function confirmSyncAction(action) {
  const provider = syncConfig.value?.provider === 'mysql' ? 'mysql' : 'cloud'
  dialog.warning({
    title: getSyncActionLabel(action),
    content: provider === 'mysql'
      ? (action === 'restore'
        ? '当前会按 MySQL 双端同步方式执行拉取，把 MySQL 中当前用户的数据写回本地，可能覆盖本地同名文件。'
        : action === 'sync'
          ? '当前会按 MySQL 双端同步方式执行，比较本地与 MySQL 中当前用户的数据，并按冲突策略执行推送、拉取或返回冲突清单。'
          : '当前会按 MySQL 双端同步方式执行推送，把当前用户数据写入 MySQL。')
      : (action === 'restore'
        ? '当前会按云端同步方式执行恢复，从云端下载 SQLite 快照并恢复当前用户数据，可能覆盖本地同名内容。'
        : action === 'sync'
          ? '当前会按云端同步方式执行，比较本地 SQLite 快照与云端快照，并自动决定上传或下载。'
          : '当前会按云端同步方式执行上传，把当前用户数据打包为 SQLite 快照上传到云端。'),
    positiveText: '继续',
    negativeText: '取消',
    onPositiveClick: async () => {
      await handleSyncAction(action)
    }
  })
}

function resetConfigPasswordModalState() {
  configPasswordModal.show = false
  configPasswordModal.mode = 'set'
  configPasswordModal.loading = false
  configPasswordModal.currentPassword = ''
  configPasswordModal.newPassword = ''
  configPasswordModal.confirmPassword = ''
  configPasswordModal.recoveryQuestion = ''
  configPasswordModal.recoveryAnswer = ''
  configPasswordModal.recoveryAnswerConfirm = ''
}

function openConfigPasswordModal(mode) {
  resetConfigPasswordModalState()
  configPasswordModal.show = true
  configPasswordModal.mode = mode
  if (mode !== 'clear') configPasswordModal.recoveryQuestion = configSecurity.value.recoveryQuestion || ''
}

function closeConfigPasswordModal() {
  resetConfigPasswordModalState()
}

async function submitConfigPasswordModal() {
  configPasswordModal.loading = true
  try {
    if (configPasswordModal.mode === 'clear') {
      const currentPassword = await assertCurrentConfigPassword(configPasswordModal.currentPassword)
      await applyConfigPasswordTransition({
        currentPassword,
        clearPassword: true
      })
      closeConfigPasswordModal()
      message.success('全局配置密码已清除')
      return
    }

    const newPassword = String(configPasswordModal.newPassword || '')
    const confirmPassword = String(configPasswordModal.confirmPassword || '')
    const question = String(configPasswordModal.recoveryQuestion || '').trim()
    const answer = String(configPasswordModal.recoveryAnswer || '')
    const answerConfirm = String(configPasswordModal.recoveryAnswerConfirm || '')

    if (!newPassword) throw new Error('新的全局配置密码不能为空')
    if (newPassword !== confirmPassword) throw new Error('两次输入的全局配置密码不一致')
    if (!question) throw new Error('安全问题不能为空')
    if (!answer) throw new Error('安全问题答案不能为空')
    if (answer !== answerConfirm) throw new Error('两次输入的安全问题答案不一致')

    let currentPassword = ''
    if (configPasswordModal.mode === 'change') {
      currentPassword = await assertCurrentConfigPassword(configPasswordModal.currentPassword)
    }

    const nextConfigSecurity = await buildConfigSecurityPayload(newPassword, question, answer)
    await applyConfigPasswordTransition({
      currentPassword,
      newPassword,
      nextConfigSecurity,
      clearPassword: false
    })
    closeConfigPasswordModal()
    message.success(configPasswordModal.mode === 'change' ? '全局配置密码已修改' : '全局配置密码已设置')
  } catch (err) {
    message.error(err?.message || String(err))
  } finally {
    configPasswordModal.loading = false
  }
}

function resetSecurityResetModalState() {
  securityResetModal.show = false
  securityResetModal.loading = false
  securityResetModal.answer = ''
  securityResetModal.newPassword = ''
  securityResetModal.confirmPassword = ''
  securityResetModal.recoveryQuestion = ''
  securityResetModal.recoveryAnswer = ''
  securityResetModal.recoveryAnswerConfirm = ''
}

function openSecurityResetModal() {
  if (!hasRecoveryQuestion.value) {
    message.warning('当前未设置可用的安全问题')
    return
  }
  resetSecurityResetModalState()
  securityResetModal.show = true
  securityResetModal.recoveryQuestion = configSecurity.value.recoveryQuestion || ''
}

function closeSecurityResetModal() {
  resetSecurityResetModalState()
}

async function submitSecurityReset() {
  securityResetModal.loading = true
  try {
    const answer = String(securityResetModal.answer || '')
    const newPassword = String(securityResetModal.newPassword || '')
    const confirmPassword = String(securityResetModal.confirmPassword || '')
    const question = String(securityResetModal.recoveryQuestion || '').trim()
    const newAnswer = String(securityResetModal.recoveryAnswer || '')
    const newAnswerConfirm = String(securityResetModal.recoveryAnswerConfirm || '')

    if (!answer) throw new Error('请输入当前安全问题答案')
    if (!newPassword) throw new Error('新的全局配置密码不能为空')
    if (newPassword !== confirmPassword) throw new Error('两次输入的全局配置密码不一致')
    if (!question) throw new Error('新的安全问题不能为空')
    if (!newAnswer) throw new Error('新的安全问题答案不能为空')
    if (newAnswer !== newAnswerConfirm) throw new Error('两次输入的安全问题答案不一致')

    const answerOk = await verifyPassword(answer, configSecurity.value.recoveryAnswerVerifier)
    if (!answerOk) throw new Error('安全问题答案错误')

    const currentPassword = await decryptTextWithPassword(configSecurity.value.passwordRecoveryEnvelope, answer)
    const nextConfigSecurity = await buildConfigSecurityPayload(newPassword, question, newAnswer)
    await applyConfigPasswordTransition({
      currentPassword,
      newPassword,
      nextConfigSecurity,
      clearPassword: false
    })
    closeSecurityResetModal()
    message.success('全局配置密码已通过安全问题重置')
  } catch (err) {
    message.error(err?.message || String(err))
  } finally {
    securityResetModal.loading = false
  }
}

function closeActionPasswordModal() {
  actionPasswordModal.show = false
  actionPasswordModal.action = ''
  actionPasswordModal.title = ''
  actionPasswordModal.description = ''
  actionPasswordModal.password = ''
  actionPasswordModal.loading = false
  actionPayload.value = null
}

function requestProtectedAction(action, payload) {
  if (!hasConfigPassword.value) {
    return performProtectedAction(action, payload)
  }

  actionPasswordModal.show = true
  actionPasswordModal.action = action
  actionPasswordModal.title = action === 'export' ? '导出配置验证' : '导入配置验证'
  actionPasswordModal.description = action === 'export'
    ? '导出配置前，请再次输入当前全局配置密码。'
    : '导入配置前，请再次输入当前全局配置密码。'
  actionPasswordModal.password = ''
  actionPasswordModal.loading = false
  actionPayload.value = payload
  return Promise.resolve()
}

async function submitActionPassword() {
  actionPasswordModal.loading = true
  try {
    const password = await assertCurrentConfigPassword(actionPasswordModal.password)
    await performProtectedAction(actionPasswordModal.action, actionPayload.value, password)
    closeActionPasswordModal()
  } catch (err) {
    message.error(err?.message || String(err))
  } finally {
    actionPasswordModal.loading = false
  }
}

async function performProtectedAction(action, payload) {
  if (!payload?.filePath) throw new Error('目标文件路径不能为空')

  if (action === 'export') {
    await exportGlobalConfigToFile(payload.filePath)
    message.success('配置已导出')
    return
  }

  await importGlobalConfigFromFile(payload.filePath)
  message.success('配置已导入')
}

async function handleExportConfig() {
  try {
    const filePath = saveFileDialog()
    if (!filePath) return
    await requestProtectedAction('export', { filePath })
  } catch (err) {
    message.error(err?.message || String(err))
  }
}

async function handleImportConfig() {
  try {
    const filePath = openFileDialog()
    if (!filePath) return
    dialog.warning({
      title: '确认导入配置',
      content: '导入会覆盖当前全局配置，是否继续？',
      positiveText: '继续导入',
      negativeText: '取消',
      onPositiveClick: async () => {
        await requestProtectedAction('import', { filePath })
      }
    })
  } catch (err) {
    message.error(err?.message || String(err))
  }
}
</script>

<style scoped>
.settings-page {
  position: relative;
  padding-bottom: 8px;
}

.settings-page::before {
  content: '';
  position: absolute;
  inset: 10px 0 auto;
  height: 220px;
  border-radius: 30px;
  background:
    radial-gradient(circle at top left, rgba(14, 165, 233, 0.16), transparent 48%),
    radial-gradient(circle at top right, rgba(34, 197, 94, 0.12), transparent 42%);
  filter: blur(6px);
  pointer-events: none;
}

.settings-page.is-dark::before {
  background:
    radial-gradient(circle at top left, rgba(56, 189, 248, 0.18), transparent 48%),
    radial-gradient(circle at top right, rgba(74, 222, 128, 0.14), transparent 42%);
}

.settings-page :deep(.n-card) {
  border-radius: 22px;
}

.config-lock-card :deep(.n-card__content) {
  padding-top: 28px;
  padding-bottom: 28px;
}

.sync-summary-shell {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  padding: 18px 20px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 20px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.9)),
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.08), transparent 52%);
}

.sync-summary-toolbar {
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-end;
  align-self: stretch;
}

.sync-summary-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.sync-summary-head__copy {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.sync-summary-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sync-summary-badges span {
  padding: 6px 11px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(255, 255, 255, 0.72);
  color: rgba(51, 65, 85, 0.92);
  font-size: 12px;
  line-height: 1.2;
}

.sync-summary-points {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px 14px;
}

.sync-summary-point {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.sync-summary-point__dot {
  width: 7px;
  height: 7px;
  margin-top: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: rgba(14, 165, 233, 0.62);
}

.mysql-sync-scope-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
}

.sync-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
  min-width: 0;
}

.sync-modal-overview {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sync-modal-overview__status,
.sync-modal-overview__mode {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  padding: 16px 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 20px;
  background: rgba(248, 250, 252, 0.76);
}

.sync-modal-overview__status {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.sync-modal-overview__status-copy,
.sync-modal-overview__label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.sync-center-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sync-center-form :deep(.n-form-item) {
  margin-bottom: 0;
}

.sync-mode-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-width: 0;
  min-height: 176px;
  padding: 20px 20px 18px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 20px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.94)),
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.1), transparent 56%),
    radial-gradient(circle at bottom left, rgba(34, 197, 94, 0.06), transparent 48%);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.sync-mode-card:hover {
  border-color: rgba(14, 165, 233, 0.26);
  box-shadow: 0 18px 34px rgba(15, 23, 42, 0.08);
  transform: translateY(-2px);
}

.sync-mode-card:focus-visible {
  outline: 2px solid rgba(14, 165, 233, 0.36);
  outline-offset: 2px;
}

.sync-mode-card.is-active {
  border-color: rgba(14, 165, 233, 0.34);
  box-shadow:
    0 20px 38px rgba(14, 165, 233, 0.16),
    inset 0 0 0 1px rgba(14, 165, 233, 0.1);
  background:
    linear-gradient(145deg, rgba(240, 249, 255, 0.99), rgba(236, 253, 245, 0.97)),
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.2), transparent 54%),
    radial-gradient(circle at bottom left, rgba(16, 185, 129, 0.12), transparent 50%);
}

.sync-mode-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.sync-mode-card__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.sync-mode-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
}

.sync-mode-card__meta span {
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: rgba(51, 65, 85, 0.92);
  font-size: 12px;
  line-height: 1.2;
}

.notebook-runtime-dependency-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(248, 252, 255, 0.96), rgba(241, 245, 249, 0.94)),
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.1), transparent 48%);
}

.notebook-runtime-command-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.86), rgba(248, 250, 252, 0.84)),
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.08), transparent 52%);
}

.notebook-runtime-command-panel__head,
.notebook-runtime-dependency-log__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.notebook-runtime-command-panel pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.05);
  color: rgba(15, 23, 42, 0.9);
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
  line-height: 1.6;
}

.notebook-runtime-dependency-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.notebook-runtime-dependency-panel__copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.notebook-runtime-dependency-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(255, 255, 255, 0.7);
}

.notebook-runtime-dependency-status__line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.notebook-runtime-dependency-status__dot {
  width: 7px;
  height: 7px;
  margin-top: 7px;
  border-radius: 999px;
  background: rgba(14, 165, 233, 0.72);
  flex: 0 0 auto;
}

.notebook-runtime-dependency-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.notebook-runtime-dependency-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(245, 158, 11, 0.24);
  background:
    linear-gradient(135deg, rgba(255, 251, 235, 0.94), rgba(255, 255, 255, 0.92)),
    radial-gradient(circle at top right, rgba(245, 158, 11, 0.08), transparent 52%);
}

.notebook-runtime-dependency-item.is-installed {
  border-color: rgba(16, 185, 129, 0.22);
  background:
    linear-gradient(135deg, rgba(240, 253, 250, 0.94), rgba(255, 255, 255, 0.92)),
    radial-gradient(circle at top right, rgba(16, 185, 129, 0.08), transparent 52%);
}

.notebook-runtime-dependency-item__copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.notebook-runtime-dependency-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.notebook-runtime-dependency-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(15, 23, 42, 0.04);
}

.notebook-runtime-dependency-log__summary {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(59, 130, 246, 0.08);
  color: rgba(30, 41, 59, 0.92);
  font-size: 13px;
  line-height: 1.55;
}

.notebook-runtime-dependency-log pre {
  margin: 0;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.55;
}

.cloud-provider-preset-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}

.cloud-provider-preset-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(14, 165, 233, 0.14);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.82), rgba(239, 246, 255, 0.88)),
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.08), transparent 52%);
}

.cloud-provider-preset-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sync-config-panel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-width: 0;
  padding: 16px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.94)),
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.07), transparent 46%);
}

.sync-config-panel--cloud {
  background:
    linear-gradient(180deg, rgba(248, 252, 255, 0.98), rgba(241, 245, 249, 0.94)),
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.12), transparent 48%);
}

.sync-config-panel--mysql {
  background:
    linear-gradient(180deg, rgba(248, 252, 250, 0.98), rgba(241, 245, 249, 0.94)),
    radial-gradient(circle at top right, rgba(34, 197, 94, 0.1), transparent 48%);
}

.sync-config-panel__hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 2px 2px 4px;
}

.sync-config-panel__hero-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.sync-config-section {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(4px);
  min-width: 0;
}

.sync-config-section__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sync-config-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 14px;
  width: 100%;
  min-width: 0;
}

.sync-config-form-grid :deep(.n-form-item) {
  margin-bottom: 0;
  min-width: 0;
}

.sync-config-form-grid :deep(.n-form-item-blank),
.sync-config-form-grid :deep(.n-input),
.sync-config-form-grid :deep(.n-input-number),
.sync-config-form-grid :deep(.n-base-selection) {
  width: 100%;
  min-width: 0;
}

.sync-center-modal :deep(.n-card) {
  max-width: 100%;
}

.sync-center-modal :deep(.n-card__content) {
  overflow-x: hidden;
}

.sync-center-modal :deep(.n-card-header) {
  padding-bottom: 14px;
}

.sync-center-modal :deep(.n-card__content),
.sync-center-modal :deep(.n-card__footer) {
  padding-top: 16px;
}

.sync-test-feedback {
  word-break: break-word;
}

.sync-config-form-grid__full {
  grid-column: 1 / -1;
}

.mysql-sync-scope-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.mysql-sync-scope-panel__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mysql-sync-scope-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 14px;
  min-height: 146px;
  padding: 14px 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 18px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(248, 250, 252, 0.92)),
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.08), transparent 50%);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.mysql-sync-scope-card:hover {
  border-color: rgba(14, 165, 233, 0.2);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
  transform: translateY(-1px);
}

.mysql-sync-scope-card.is-enabled {
  border-color: rgba(14, 165, 233, 0.3);
  box-shadow: 0 14px 28px rgba(14, 165, 233, 0.12);
}

.mysql-sync-scope-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.mysql-sync-scope-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.mysql-sync-scope-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
}

.mysql-conflict-card :deep(.n-card__content) {
  padding: 0;
}

.mysql-conflict-card__layout {
  display: flex;
  align-items: stretch;
  gap: 18px;
  padding: 18px;
}

.mysql-conflict-card__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.mysql-conflict-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mysql-conflict-card__key {
  word-break: break-all;
}

.mysql-conflict-card__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.mysql-conflict-side {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(248, 250, 252, 0.86);
}

.mysql-conflict-side--local {
  background:
    linear-gradient(135deg, rgba(240, 253, 250, 0.95), rgba(236, 253, 245, 0.92)),
    radial-gradient(circle at top right, rgba(16, 185, 129, 0.08), transparent 52%);
}

.mysql-conflict-side--remote {
  background:
    linear-gradient(135deg, rgba(239, 246, 255, 0.95), rgba(238, 242, 255, 0.92)),
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.08), transparent 52%);
}

.mysql-conflict-card__actions {
  width: 116px;
  justify-content: center;
}

.settings-page.is-dark .sync-summary-shell,
.sync-center-modal.is-dark .sync-summary-shell,
.settings-page.is-dark .sync-modal-overview__status,
.sync-center-modal.is-dark .sync-modal-overview__status,
.settings-page.is-dark .sync-modal-overview__mode,
.sync-center-modal.is-dark .sync-modal-overview__mode {
  border-color: rgba(148, 163, 184, 0.16);
  background:
    linear-gradient(145deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.88)),
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.14), transparent 52%);
}

.settings-page.is-dark .sync-summary-badges span,
.sync-center-modal.is-dark .sync-summary-badges span {
  border-color: rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.54);
  color: rgba(226, 232, 240, 0.92);
}

.settings-page.is-dark .sync-summary-point__dot,
.sync-center-modal.is-dark .sync-summary-point__dot {
  background: rgba(56, 189, 248, 0.76);
}

.settings-page.is-dark .mysql-sync-scope-card,
.sync-center-modal.is-dark .mysql-sync-scope-card {
  border-color: rgba(148, 163, 184, 0.18);
  background:
    linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.9)),
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.16), transparent 52%);
}

.settings-page.is-dark .mysql-sync-scope-toggle,
.sync-center-modal.is-dark .mysql-sync-scope-toggle {
  border-top-color: rgba(148, 163, 184, 0.16);
}

.settings-page.is-dark .sync-mode-card,
.sync-center-modal.is-dark .sync-mode-card {
  border-color: rgba(148, 163, 184, 0.18);
  background:
    linear-gradient(145deg, rgba(15, 23, 42, 0.94), rgba(30, 41, 59, 0.9)),
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.18), transparent 54%),
    radial-gradient(circle at bottom left, rgba(16, 185, 129, 0.1), transparent 48%);
}

.settings-page.is-dark .sync-mode-card:hover,
.sync-center-modal.is-dark .sync-mode-card:hover {
  border-color: rgba(56, 189, 248, 0.28);
  box-shadow: 0 16px 30px rgba(2, 132, 199, 0.18);
}

.settings-page.is-dark .sync-mode-card.is-active,
.sync-center-modal.is-dark .sync-mode-card.is-active {
  border-color: rgba(56, 189, 248, 0.36);
  box-shadow:
    0 18px 36px rgba(2, 132, 199, 0.22),
    inset 0 0 0 1px rgba(56, 189, 248, 0.08);
  background:
    linear-gradient(145deg, rgba(8, 47, 73, 0.94), rgba(6, 95, 70, 0.9)),
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.26), transparent 54%);
}

.settings-page.is-dark .sync-mode-card__meta span,
.sync-center-modal.is-dark .sync-mode-card__meta span {
  background: rgba(15, 23, 42, 0.58);
  border-color: rgba(148, 163, 184, 0.18);
  color: rgba(226, 232, 240, 0.92);
}

.settings-page.is-dark .notebook-runtime-dependency-panel,
.notebook-runtime-modal.is-dark .notebook-runtime-dependency-panel,
.sync-center-modal.is-dark .notebook-runtime-dependency-panel {
  border-color: rgba(148, 163, 184, 0.16);
  background:
    linear-gradient(180deg, rgba(10, 37, 64, 0.94), rgba(15, 23, 42, 0.92)),
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.16), transparent 48%);
}

.settings-page.is-dark .notebook-runtime-dependency-status,
.notebook-runtime-modal.is-dark .notebook-runtime-dependency-status,
.sync-center-modal.is-dark .notebook-runtime-dependency-status,
.settings-page.is-dark .cloud-provider-preset-card,
.sync-center-modal.is-dark .cloud-provider-preset-card {
  border-color: rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.52);
}

.settings-page.is-dark .notebook-runtime-command-panel,
.notebook-runtime-modal.is-dark .notebook-runtime-command-panel,
.sync-center-modal.is-dark .notebook-runtime-command-panel {
  border-color: rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.52);
}

.settings-page.is-dark .notebook-runtime-command-panel pre,
.notebook-runtime-modal.is-dark .notebook-runtime-command-panel pre,
.sync-center-modal.is-dark .notebook-runtime-command-panel pre {
  border-color: rgba(148, 163, 184, 0.16);
  background: rgba(2, 6, 23, 0.48);
  color: rgba(226, 232, 240, 0.92);
}

.settings-page.is-dark .notebook-runtime-dependency-item,
.notebook-runtime-modal.is-dark .notebook-runtime-dependency-item,
.sync-center-modal.is-dark .notebook-runtime-dependency-item {
  border-color: rgba(245, 158, 11, 0.22);
  background:
    linear-gradient(135deg, rgba(69, 26, 3, 0.34), rgba(15, 23, 42, 0.9)),
    radial-gradient(circle at top right, rgba(245, 158, 11, 0.12), transparent 52%);
}

.settings-page.is-dark .notebook-runtime-dependency-item.is-installed,
.notebook-runtime-modal.is-dark .notebook-runtime-dependency-item.is-installed,
.sync-center-modal.is-dark .notebook-runtime-dependency-item.is-installed {
  border-color: rgba(16, 185, 129, 0.22);
  background:
    linear-gradient(135deg, rgba(6, 78, 59, 0.34), rgba(15, 23, 42, 0.9)),
    radial-gradient(circle at top right, rgba(16, 185, 129, 0.12), transparent 52%);
}

.settings-page.is-dark .notebook-runtime-dependency-log,
.notebook-runtime-modal.is-dark .notebook-runtime-dependency-log,
.sync-center-modal.is-dark .notebook-runtime-dependency-log {
  border-color: rgba(148, 163, 184, 0.16);
  background: rgba(2, 6, 23, 0.5);
}

.settings-page.is-dark .notebook-runtime-dependency-log__summary,
.notebook-runtime-modal.is-dark .notebook-runtime-dependency-log__summary,
.sync-center-modal.is-dark .notebook-runtime-dependency-log__summary {
  background: rgba(59, 130, 246, 0.12);
  color: rgba(226, 232, 240, 0.92);
}

.settings-page.is-dark .sync-config-panel,
.sync-center-modal.is-dark .sync-config-panel {
  border-color: rgba(148, 163, 184, 0.16);
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.94), rgba(30, 41, 59, 0.92)),
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.14), transparent 48%);
}

.settings-page.is-dark .sync-config-panel--cloud,
.sync-center-modal.is-dark .sync-config-panel--cloud {
  background:
    linear-gradient(180deg, rgba(10, 37, 64, 0.94), rgba(15, 23, 42, 0.92)),
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.2), transparent 48%);
}

.settings-page.is-dark .sync-config-panel--mysql,
.sync-center-modal.is-dark .sync-config-panel--mysql {
  background:
    linear-gradient(180deg, rgba(11, 48, 38, 0.92), rgba(15, 23, 42, 0.92)),
    radial-gradient(circle at top right, rgba(34, 197, 94, 0.18), transparent 48%);
}

.settings-page.is-dark .sync-config-section,
.sync-center-modal.is-dark .sync-config-section {
  border-color: rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.48);
}

.settings-page.is-dark .mysql-sync-scope-card:hover,
.settings-page.is-dark .mysql-sync-scope-card.is-enabled,
.sync-center-modal.is-dark .mysql-sync-scope-card:hover,
.sync-center-modal.is-dark .mysql-sync-scope-card.is-enabled {
  border-color: rgba(56, 189, 248, 0.3);
  box-shadow: 0 14px 28px rgba(2, 132, 199, 0.18);
}

.settings-page.is-dark .mysql-conflict-side {
  border-color: rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.78);
}

.settings-page.is-dark .mysql-conflict-side--local {
  background:
    linear-gradient(135deg, rgba(6, 78, 59, 0.36), rgba(15, 23, 42, 0.88)),
    radial-gradient(circle at top right, rgba(16, 185, 129, 0.16), transparent 52%);
}

.settings-page.is-dark .mysql-conflict-side--remote {
  background:
    linear-gradient(135deg, rgba(30, 64, 175, 0.34), rgba(15, 23, 42, 0.88)),
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.18), transparent 52%);
}

@media (max-width: 900px) {
  .notebook-runtime-dependency-grid,
  .sync-mode-grid,
  .sync-config-form-grid,
  .mysql-sync-scope-grid {
    grid-template-columns: 1fr;
  }

  .sync-summary-points {
    grid-template-columns: 1fr;
  }

  .mysql-conflict-card__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .notebook-runtime-dependency-panel__header,
  .cloud-provider-preset-card__head {
    flex-direction: column;
    align-items: flex-start;
  }

  .sync-summary-toolbar {
    width: 100%;
  }

  .sync-summary-head,
  .sync-modal-overview__status,
  .sync-config-panel__hero,
  .mysql-sync-scope-card {
    flex-direction: column;
    align-items: stretch;
  }

  .sync-summary-shell,
  .sync-modal-overview__status,
  .sync-modal-overview__mode,
  .sync-config-panel,
  .sync-config-section,
  .mysql-sync-scope-card {
    padding-left: 14px;
    padding-right: 14px;
  }

  .mysql-sync-scope-toggle {
    align-items: stretch;
  }

  .sync-mode-card,
  .mysql-sync-scope-card {
    min-height: unset;
  }

  .mysql-conflict-card__layout {
    flex-direction: column;
  }

  .mysql-conflict-card__actions {
    width: 100%;
  }
}

</style>


