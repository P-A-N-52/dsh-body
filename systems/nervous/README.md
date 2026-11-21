# 神经系统

> **legacy evidence only, not simulation.** 本目录只保留证据与索引，不承载仿真；仿真脚本在 `organs/human-organs/`。

P1 的体感读出已迁到 [`organs/human-organs/brain/interoception.ts`](../../organs/human-organs/brain/interoception.ts)：它读取胃充盈、相对饥饿素与十二指肠营养暴露，写 `interoception.hunger` / `fullness`。提醒策略在 [`notify.ts`](../../organs/human-organs/brain/notify.ts)，按会话做显著性、冷却和次数限制；`index.js` 的 `notifications.js` 负责投递。通知历史文件与模型已读确认尚未实现。[体感与提醒](../../organs/human-organs/brain/README.md) · [神经系统的体感与通报](../../docs/virtual-body.md#神经系统的体感与通报)

优先找同一受试者餐前、餐后的主观饥饿与饱胀评分，记下量表端点和采样时刻。若同一实验还测了胃内容量或饥饿素，再对齐三组曲线。M3 再查睡眠压力与困意的时间过程。[胃壁机械感受](../../organs/human-organs/stomach/README.md) · [胃饥饿素](../../organs/human-organs/stomach/README.md)

M1 主观饥饿与饱胀评分的候选来源见[共享登记簿](../../organs/human-organs/references/source-index.csv)；饥饿素的逐篇笔记见 [Cummings 2001](../../organs/human-organs/stomach/references/notes/cummings-2001.md)。
