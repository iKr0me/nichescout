# Commerce-track — provider feasibility report

Generated: 2026-09-19T16:11:47.602Z
Test keyword: `phone stand`  |  destination: `US`  |  origin: `CN`

Secrets are never included in this report. All values below are field names, counts and samples of non-secret data.

Calls made — CJ: 5, SerpApi: 0, OpenAI: 0

| Provider | Check | Result | Detail |
|---|---|---|---|
| CJ | authentication/getAccessToken | PASS | host developers.cjdropshipping.com |
| CJ | product/listV2 returns candidates | PASS | 20 items for "phone stand" |
| CJ | product ID present in list result | PASS | pid length 36 |
| CJ | product/query returns variants | PASS | 4 variants |
| CJ | variant ID (vid) non-empty | PASS | present |
| CJ | variant SKU non-empty | PASS | present |
| CJ | variant field names/types (sanitized) | PASS | vid:string, pid:string, variantName:null, variantNameEn:string, variantImage:string, variantSku:string, barcode:string, variantUnit:null, variantProperty:null, variantKey:string, variantLength:number, variantWidth:number, variantHeight:number, variantVolume:number, variantWeight:number, variantSellPrice:number, createTime:number, variantStandard:string, variantSugSellPrice:number, combineNum:null, inventoryNum:null, combineVariants:null, inventories:null |
| CJ | variant price numeric > 0 | PASS | variantSellPrice = 0.64 |
| CJ | variant weight numeric | PASS | variantWeight = 30 |
| CJ | variant inventory (stock/queryByVid) | PASS | vid matched in CN: CJ-held 0, factory 13524 (total 13524 reported separately, child stock[] not summed) |
| CJ | variant image URL non-empty | PASS | via variantImage |
| CJ | freightCalculate returns options | PASS | 18 methods CN->US |
| CJ | freight field names/types (sanitized) | PASS | logisticAging:string, logisticPrice:number, logisticPriceCn:number, logisticName:string, channelId:null, error:null, errorEn:null, optionId:null, postage:null, postageCNY:null, priceIncreases:null, reSort:null, remoteFee:null, remoteFeeCNY:null, tip:null, orderId:null, unWeightChargeTarget:null, volumeWeight:null, floatMaxPrice:null, floatMinPrice:null, logisticsParamRespDTO:null, message:null, wrapPostage:null, wrapPostageCNY:null, wrapWeight:null, ruleTipTypes:null, stopWords:null, channel:null, cjRespDTO:null, destArea:null, srcArea:null, option:null, zonePrice:array, allRuleTips:null, ruleTips:null, taxesFee:number, clearanceOperationFee:number, recommendLogisticsTypeList:array, timePrioritySort:null, pricePrioritySort:null, compositeRecommendSort:null, totalPostageFee:number |
| CJ | freight cost numeric, non-negative | PASS | logisticPrice = 5.07 |
| CJ | shipping method identifier (logisticName) | PASS | logisticName = CJPacket Sensitive Pro |
| CJ | delivery estimate numeric days | PASS | logisticAging = "5-11" parsed as range; upper bound 11 days used for maxShippingDays gate |

**No blocking failures.**

**No warnings.**
