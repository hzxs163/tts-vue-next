export default {
  common: {
    appName: "TTS Vue Next",
    formats: {
      mp3: "MP3",
      wav: "WAV",
      ogg: "OGG",
      flac: "FLAC",
    },
  },
  nav: {
    textToSpeech: "文本转换",
    batchConvert: "批量转换",
    settings: "设置",
    versionCurrent: "版本 {version}",
    versionUpdateAvailable: "版本 {current} → {latest}",
  },
  titleBar: {
    openRepository: "打开 GitHub 仓库",
    openRepositoryFailed: "打开仓库失败，请重试。",
    toggleTheme: "切换主题",
    minimize: "最小化窗口",
    toggleMaximize: "切换最大化窗口",
    close: "关闭窗口",
    windowActionFailed: "窗口操作失败，请重试。",
  },
  tts: {
    textInput: {
      title: "文本输入",
      placeholder: "请输入要转换为语音的文本...",
      clear: "清空文本",
    },
    options: {
      title: "语音控制面板",
      language: "语言",
      voice: "音色",
      rate: "语速",
      pitch: "音调",
      volume: "音量",
      outputFormat: "输出格式",
      generate: "生成语音",
      generating: "正在生成...",
      stop: "停止",
    },
    audioPlayer: {
      title: "播放控制台",
      togglePlayback: "切换播放状态",
      saveGeneratedAudio: "保存生成的音频",
      saveFilterName: "音频文件",
      defaultFileName: "语音输出.{ext}",
      saved: "已保存到 {path}",
    },
  },
  batch: {
    hero: {
      overline: "批量转换工作台",
      title: "批量转换",
      description: "将文本文件加入队列，逐项查看进度，并以可控并发导出音频。",
    },
    options: {
      title: "批量控制面板",
    },
    actions: {
      startAll: "全部开始",
      stopAll: "停止全部",
      clear: "清空",
      concurrency: "并发数",
    },
    upload: {
      title: "将文本文件拖入队列",
      description: "点击浏览，或将 `.txt`、`.md`、`.markdown` 和 `.docx` 文件拖放到这里。",
      chooseFiles: "选择文件",
      unsupportedFileTypes: "不支持的文件类型：{files}",
      filePickerFilterName: "文本文件",
    },
    list: {
      title: "队列进度",
      columns: {
        file: "文件",
        status: "状态",
        progress: "进度",
        actions: "操作",
      },
      emptyTitle: "还没有排队的文件",
      emptyDescription: "可以直接将文件拖放到这里，或使用下方按钮选择文件。",
      status: {
        completed: "已完成",
        failed: "失败",
        skipped: "已跳过",
        processing: "处理中",
        queued: "排队中",
      },
    },
    errors: {
      failedToRemoveTempFile: "删除临时文件失败 {path}：{message}",
    },
  },
  settings: {
    hero: {
      overline: "偏好设置",
      title: "调整输出和处理行为",
      description: "选择转换音频的保存位置，并设置批量任务的执行强度。",
    },
    sections: {
      output: "输出",
      processing: "处理",
      about: "关于",
    },
    fields: {
      savePath: "保存路径",
      savePathPlaceholder: "点击选择...",
      defaultFormat: "默认格式",
      displayLanguage: "显示语言",
      autoplay: "转换后自动播放",
      maxRetries: "最大重试次数",
      fileConcurrency: "文件并发数",
      chunkConcurrency: "分段并发数",
      conflictStrategy: "同名文件处理",
    },
    conflictStrategies: {
      overwrite: "覆盖已有文件",
      skip: "跳过已有文件",
      rename: "自动重命名",
    },
    languages: {
      zh: "简体中文",
      en: "English",
    },
    about: {
      description:
        "一个由 Microsoft Edge TTS 服务驱动，并基于 Vue 3、Vuetify 和 Tauri 构建的桌面 TTS 应用。",
    },
  },
  errors: {
    auth: "微软语音接口拒绝访问（鉴权规则可能已变更），请更新应用或检查端点配置。",
    network: "无法连接微软语音服务，请检查网络或代理设置。",
    timeout: "语音服务连接超时，请稍后重试。",
    cancelled: "转换已取消。",
    unknown: "转换失败：{message}",
    voiceCache: "发音人列表加载失败，已使用本地缓存，部分音色可能不是最新。",
  },
} as const;
