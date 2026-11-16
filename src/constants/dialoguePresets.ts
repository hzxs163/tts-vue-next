import type { DialogueCastPreset, DialogueRole } from "../types";

export const DEFAULT_CAST_PRESETS: DialogueCastPreset[] = [
  {
    id: "xianxia",
    name: "玄幻修仙 / 经典广播剧",
    description: "大气旁白 + 热血男主 + 仙风道骨老者 + 温柔女主",
    roles: [
      {
        id: "role-narrator",
        name: "旁白",
        voice: "zh-CN-YunyangNeural",
        rate: 0,
        pitch: 0,
        volume: 0,
        color: "primary",
        isDefault: true,
      },
      {
        id: "role-male-lead",
        name: "萧炎",
        voice: "zh-CN-YunxiNeural",
        rate: 5,
        pitch: 0,
        volume: 0,
        color: "info",
      },
      {
        id: "role-master",
        name: "药老",
        voice: "zh-CN-YunjianNeural",
        rate: -5,
        pitch: -10,
        volume: 5,
        color: "warning",
      },
      {
        id: "role-female-lead",
        name: "熏儿",
        voice: "zh-CN-XiaoxiaoNeural",
        rate: 0,
        pitch: 8,
        volume: 0,
        color: "success",
      },
    ],
  },
  {
    id: "urban",
    name: "现代都市 / 职场情感剧",
    description: "磁性叙事 + 沉稳男主 + 知性干练女主",
    roles: [
      {
        id: "role-urban-narrator",
        name: "旁白",
        voice: "zh-CN-YunyangNeural",
        rate: 0,
        pitch: 0,
        volume: 0,
        color: "primary",
        isDefault: true,
      },
      {
        id: "role-urban-male",
        name: "林辰",
        voice: "zh-CN-YunxiNeural",
        rate: 0,
        pitch: -2,
        volume: 0,
        color: "indigo",
      },
      {
        id: "role-urban-female",
        name: "苏晴",
        voice: "zh-CN-XiaoyiNeural",
        rate: 2,
        pitch: 4,
        volume: 0,
        color: "pink",
      },
    ],
  },
  {
    id: "fairytale",
    name: "童话故事 / 亲子寓言",
    description: "温和讲故事妈妈 + 活泼小男孩 + 甜美小女孩",
    roles: [
      {
        id: "role-fairy-narrator",
        name: "故事妈妈",
        voice: "zh-CN-XiaoxiaoNeural",
        rate: -2,
        pitch: 2,
        volume: 0,
        color: "purple",
        isDefault: true,
      },
      {
        id: "role-fairy-boy",
        name: "皮皮",
        voice: "zh-CN-YunxiNeural",
        rate: 10,
        pitch: 15,
        volume: 0,
        color: "teal",
      },
      {
        id: "role-fairy-girl",
        name: "朵朵",
        voice: "zh-CN-XiaoxiaoNeural",
        rate: 8,
        pitch: 22,
        volume: 0,
        color: "amber",
      },
    ],
  },
];

export const INITIAL_ROLES: DialogueRole[] = DEFAULT_CAST_PRESETS[0].roles;

export const SAMPLE_DIALOGUE_SCRIPT = `旁白：落日的余晖洒在青石板街上，晚风微凉，街道两旁挂起昏黄的灯笼。
萧炎：“老师，前面就是乌坦城了，我们真的要进去吗？”
药老：“嗯，小心为上。此地纳兰家族耳目众多，切勿暴露踪迹。”
萧炎：“明白！弟子必定收敛气息，绝不鲁莽。”
熏儿：“萧炎哥哥，放心吧，熏儿也会一直在你身边的。”
旁白：少年微微压低兜帽，三人身影在暮色中疾驰而过，悄然隐入夜色之中。`;
