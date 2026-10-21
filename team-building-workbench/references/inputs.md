# 可选参考项目

`--references` 接受 UTF-8 JSON 数组，也接受UTF-8 BOM。只有 `name` 必填，其余字段均可省略：

```json
[
  {"name":"团队聚餐","play":"dinner","budget":"2500.50","pricingMode":"per_event"},
  {"name":"饮品外卖","play":"small-indoor","budget":"25","pricingMode":"per_person"},
  {"name":"公园徒步","play":"travel"}
]
```

| 字段 | 约定 |
| --- | --- |
| name | 1–80字，项目名称 |
| budget | 人民币元、非负、最多两位小数；省略为未知，0为真实零费用 |
| pricingMode | `per_event` 整场一次（默认），或 `per_person` 按人均 |
| play | `travel` 出游、`tea` 下午茶、`dinner` 晚餐、`indoor` 大型室内、`small-indoor` 小型室内、`other` 自由活动；也可填对应中文标签 |
| location | 可选；当前中文地址校验须包含城市和区/县/镇，例如“示例市示例区” |

省略玩法时脚本按常见关键词分类，未命中的归“自由活动”。外部Agent应根据用户已给内容选定预置分类，不追加必填问题。`indoor` 项目明确按大型室内，`small-indoor` 按小型室内。

提供参考数组会替换默认示例项目，不替换预置L1/L2。不提供则生成无估价、无地点的通用候选：公园徒步、茶点分享、团队聚餐、室内运动场、桌游、饮品外卖、KTV。参考价不会写成历史实付。

初始化可选参数：`--name`（默认团建工作台）、`--quarter YYYY-q1`（默认上海时区当前季度）。`--out` 是Agent选择的技术输出目录，不应成为向用户追问的业务项。
