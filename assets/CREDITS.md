# 第三方素材

本项目的**代码**与本文件所列**素材**分属不同许可，界线在这里划清。

## 整车模型

**Carbon Frame Bike**

- 建模：[Robert Schweier](http://www.roberts-bikes.de/)
- 实时化与动画：Felix Herbst / [prefrontal cortex](https://prefrontalcortex.de)，[Needle](https://needle.tools) 协助
- 许可：[CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/)
- 出处：`prefrontalcortex/glTF-Sample-Models` 分支 `carbon-frame-bike`，
  路径 `2.0/CarbonFrameBike/glTF-Binary/CarbonFrameBike.glb`
- 同一资产的 USDZ 版在 `usd-wg/assets` 的 `full_assets/CarbonFrameBike`
- 本仓库内文件：`public/models/CarbonFrameBike.glb`
- SHA-256 前 16 位：`95c016737df48d1b`，12,183,440 字节

选用未压缩的 `glTF-Binary` 而非同目录下 3.24 MB 的 `glTF-Draco-KTX2`，
理由是后者的 KTX2 走 ETC1S 档，而这份资产 11 张贴图里有 7 张是法线贴图 ——
ETC1S 的码本按感知颜色优化，压方向向量会在曲面上留下着色不连续。
低配档另行用 UASTC 自行转制，不使用上游的 ETC1S 版本。

### CC BY-SA 4.0 的影响

ShareAlike 只对**该模型及其改作**生效：本仓库对模型所做的任何修改
（重新导出、减面、贴图转码）同样以 CC BY-SA 4.0 发布。
它不传染到本仓库的代码 —— 代码与模型是「聚合」而非「改编」关系。
