const AdwordsUser = require('node-adwords').AdwordsUser;
const AdwordsConstants = require('node-adwords').AdwordsConstants;
const AdwordsAuth = require('node-adwords').AdwordsAuth;
const express = require('express');
const fs = require('fs');
const app = express();
const csv = require('csvtojson');
require('dotenv').config();
app.set('view engine', 'pug');
app.set('views', './views');

const client_id = process.env.clientId;
const client_secret = process.env.clientSecret;
const refresh_token = process.env.refreshToken;
const clientCustomerId = process.env.clientCustomerId;
const userAgent = process.env.userAgent;
const developerToken = process.env.developerToken;
const version = 'v201809';
const AdwordsReport = require('node-adwords').AdwordsReport;

const user = new AdwordsUser({
	developerToken,
	userAgent,
	clientCustomerId,
	client_id,
	client_secret,
	refresh_token
});

const auth = new AdwordsAuth({
	client_id,
	client_secret,
}, 'http://localhost:3000/adwords/auth' /** insert your redirect url here */);

app.get('/adwords/go', (req, res) => {
	res.redirect(auth.generateAuthenticationUrl());
});

app.listen(3000, function () {
	console.log('Example app listening on port 3000!');
});

app.get('/adwords/auth', (req, res) => {
	auth.getAccessTokenFromAuthorizationCode(req.query.code, (error, tokens) => {
		res.send(tokens.refresh_token);
	})
});

app.get('/get_campaigns', (req, res) => {
	const campaignService = user.getService('CampaignService', version);
	const selector = {
		fields: ['Id', 'Name', 'Status'],
		ordering: [{field: 'Name', sortOrder: 'ASCENDING'}],
		paging: {startIndex: 0, numberResults: AdwordsConstants.RECOMMENDED_PAGE_SIZE}
	};

	campaignService.get({serviceSelector: selector}, (error, result) => {

		res.render('campaigns', { campaigns: result.entries || [], total: result.totalNumEntries });
	})
});

app.get('/campaign/:id', (req, res) => {
	const campaignId = req.params.id;
	const report = new AdwordsReport({
		developerToken,
		userAgent,
		clientCustomerId,
		client_id,
		client_secret,
		refresh_token
	});
	const results = [];
	report.getReport(version, {
		reportName: 'Custom Adgroup Performance Report',
		reportType: 'CAMPAIGN_PERFORMANCE_REPORT',
		fields: ['CampaignId', 'Impressions', 'Clicks', 'Cost', 'CampaignStatus'],
		filters: [
			{field: 'CampaignId', operator: 'EQUALS', values: [campaignId]}
		],
		dateRangeType: 'ALL_TIME', //defaults to CUSTOM_DATE. startDate or endDate required for CUSTOM_DATE
		format: 'CSV' //defaults to CSV
	}, (error, rawReport) => {
		csv({ noheader:true, })
			.fromString(rawReport)
			.then((csvRow)=>{
				Object.keys(csvRow[1]).forEach(key => results.push({ label: csvRow[1][key], value: csvRow[2][key]}));
				res.render('campaign', { results });
			})
	});
});

const createAdGroup = (campaign, cb) => {
	const adgroupService = user.getService('AdGroupService', version);

	const adgroup = {
		campaignId: campaign.id,
		name: 'TestAdgroup ' + Date.now(),
		status: 'ENABLED',
		biddingStrategyConfiguration: {
			bids: [{
				'xsi:type': 'CpaBid',
				bid: {
					'xsi:type': 'Money',
					microAmount: 1000000
				}
			}]
		}
	};

	const adgroupOperation = {
		operator: 'ADD',
		operand: adgroup
	};

	adgroupService.mutate({operations: [adgroupOperation]}, (error, groupResult) => {
		if (error) {
			return cb(error);
		}
		const group = groupResult.value[0];
		return cb(null, group);
	});
};

const createBudget = (cb) => {
	const budgetService = user.getService('BudgetService', version);
	const budget = {
		name: 'budget for ' + Date.now(),
		amount: {
			microAmount: 1000000,
			'xsi:type': 'Money'
		},
		deliveryMethod: 'STANDARD'
	};

	const budgetOperation = {
		operator: 'ADD',
		operand: budget
	};

	budgetService.mutate({operations:[budgetOperation]}, (error, budgetResult) => {
		if (error) {
			return cb(error);
		}
		const budget = budgetResult.value[0];
		return cb(null, budget);
	});
};

const createCampaign = (budgetId, cb) => {
	const campaignService = user.getService('CampaignService', version);
	const campaign = {
		name: 'TestCampaign - ' + Date.now(),
		status: 'ENABLED',
		budget: {
			budgetId
		},
		advertisingChannelType: 'SEARCH',
		biddingStrategyConfiguration: {
			biddingStrategyType: 'MANUAL_CPC'
		}
	};

	const operation = {
		operator: 'ADD',
		operand: campaign
	};

	campaignService.mutate({operations: [operation]}, (error, result) => {
		if (!error) {
			return cb(null, result.value[0]);
		}
		return cb(error, result);
	});
};

const createAsset = (size, cb) => {
	const assetService = user.getService('AssetService', version);
	const data = fs.readFileSync(`images/${size}.jpg`);
	const base64Data = data.toString('base64');
	const asset = {
		'xsi:type': 'ImageAsset',
		assetSubtype: 'IMAGE',
		imageData: base64Data
	};
	const assetOperation = {
		operator: 'ADD',
		operand: asset
	};
	assetService.mutate({operations: [assetOperation]}, (error, result) => {
		if (!error) {
			return cb(null, result.value[0].assetId);
		}
		return cb(error, result);
	});

};

const createAd = (group, cb) => {
	const adService = user.getService('AdGroupAdService', version);
	createAsset('600x315', (error, largeAssetId) => {
		createAsset('300x300', (error, squareAssetId) => {
			if (!error) {
				const ad = {
					adGroupId: group.id,
					/*
						https://developers.google.com/adwords/api/docs/reference/v201809/AdGroupAdService.MultiAssetResponsiveDisplayAd
 					*/
					ad: {
						'xsi:type': 'MultiAssetResponsiveDisplayAd',
						'finalUrls': ['http://www.example.com'],
						marketingImages: {
							'xsi:type': 'AssetLink',
							asset: {
								'xsi:type': 'ImageAsset',
								assetId: largeAssetId,
								fullSizeInfo: {
									'xsi:type': 'ImageDimensionInfo',
									imageHeight: 315,
									imageWidth: 600,
								}
							}
						},
						squareMarketingImages: {
							'xsi:type': 'AssetLink',
							asset: {
								'xsi:type': 'ImageAsset',
								assetId: squareAssetId,
								fullSizeInfo: {
									'xsi:type': 'ImageDimensionInfo',
									imageHeight: 300,
									imageWidth: 300,
								}
							}
						},
						headlines: {
							'xsi:type': 'AssetLink',
							asset: {
								'xsi:type': 'TextAsset',
								assetText: 'headlines'
							}
						},
						longHeadline: {
							'xsi:type': 'AssetLink',
							asset: {
								'xsi:type': 'TextAsset',
								assetText: 'headlines'
							}
						},
						descriptions: {
							'xsi:type': 'AssetLink',
							asset: {
								'xsi:type': 'TextAsset',
								assetText: 'headlines'
							}
						},
						businessName: 'TestAd business name'
					},
					status: 'ENABLED',
				};
				const adOperation = {
					operator: 'ADD',
					operand: ad
				};
				adService.mutate({operations: [adOperation]}, (error, result) => {
					if (!error) {
						return cb(null, result.value[0]);
					}
					return cb(error, result);
				});
			} else {
				return cb(error, null);
			}
		})
	});
};

const addCriterion = (adGroupId, cb) => {
	const criterionService = user.getService('AdGroupCriterionService', version);
	const criteria1 = {
		'xsi:type': 'BiddableAdGroupCriterion',
		adGroupId,
		criterion: {
			'xsi:type': 'Keyword',
			text: 'test search included',
			matchType: 'EXACT'
		}
	};
	const criteria2 = {
		'xsi:type': 'NegativeAdGroupCriterion',
		adGroupId,
		criterion: {
			'xsi:type': 'Keyword',
			text: 'test search excluded',
			matchType: 'EXACT'
		}
	};
	const criterionOperation1 = {
		operator: 'ADD',
		operand: criteria1
	};
	const criterionOperation2 = {
		operator: 'ADD',
		operand: criteria2
	};
	criterionService.mutate({operations: [criterionOperation1, criterionOperation2]}, (error, result) => {
		if (!error) {
			const criteria3 = {
				'xsi:type': 'BiddableAdGroupCriterion',
				adGroupId,
				criterion: {
					'xsi:type': 'AgeRange',
					id: result.value[0].criterion.id,
					ageRangeType: 'AGE_RANGE_25_34'
				}
			};
			const criterionOperation3 = {
				operator: 'SET',
				operand: criteria3
			};
			criterionService.mutate({operations: [criterionOperation3]}, (error, result) => {
				if (!error) {
					return cb(null, result);
				}
				return cb(error, result);
			});
		}
	});
};

app.get('/create_campaign', (req, res) => {
	createBudget((budgetError, budget) => {
		if (budgetError) {
			return res.render('error', { error: budgetError });
		}
		createCampaign(budget.budgetId, (campaignError, campaign) => {
			if (campaignError) {
				return res.render('error', { error: campaignError });
			}
			createAdGroup(campaign, (adCroupError, adGroupResult) => {
				if (adCroupError) {
					return res.render('error', { error: adCroupError });
				}
				addCriterion(adGroupResult.id, (criterionError) => {
					if (criterionError) {
						return res.render('error', { error: criterionError });
					}
					createAd(adGroupResult, (adError, adResult) => {
						if (adError) {
							return res.render('error', { error: adError });
						}
						return res.render('create_campaign', { campaignResult: adResult });
					});
				});
			})
		})
	});
});

app.get('/stop_campaign/:id', (req, res) => {
	const campaignId = req.params.id;
	const campaignService = user.getService('CampaignService', version);

	const selector = {
		fields: ['BudgetId', 'BudgetStatus'],
		predicates: [
			{field: 'Id', operator: 'EQUALS', values: [campaignId]},

		],
		paging: {startIndex: 0, numberResults: AdwordsConstants.RECOMMENDED_PAGE_SIZE}
	};

	campaignService.get({serviceSelector: selector}, (error, result) => {
		if (result.entries && result.entries.length) {
			const campaignDeleteOperation = {
				operator: 'SET',
				operand: {
					id: campaignId,
					status: 'PAUSED'
				}
			}
			campaignService.mutate({operations: [campaignDeleteOperation]}, (error) => {
				if (error) {
					return res.render('error', { error });
				}
				return res.redirect('/get_campaigns');
			});
		}
	})


});

app.get('/delete_campaign/:id', (req, res) => {
	const campaignId = req.params.id;
	const campaignService = user.getService('CampaignService', version);
	const budgetService = user.getService('BudgetService', version);

	const selector = {
		fields: ['BudgetId', 'BudgetStatus'],
		predicates: [
			{field: 'Id', operator: 'EQUALS', values: [campaignId]},

		],
		paging: {startIndex: 0, numberResults: AdwordsConstants.RECOMMENDED_PAGE_SIZE}
	};

	campaignService.get({serviceSelector: selector}, (error, result) => {
		if (result.entries && result.entries.length) {
			const budget = result.entries[0].budget || {};
			const campaignDeleteOperation = {
				operator: 'SET',
				operand: {
					id: campaignId,
					status: 'REMOVED'
				}
			}
			campaignService.mutate({operations: [campaignDeleteOperation]}, (error) => {
				if (error) {
					if (error) {
						return res.render('error', { error });
					}
				}
				const budgetOperation = {
					operator: 'REMOVE',
					operand: {
						budgetId: budget.budgetId
					}
				};
				budgetService.mutate({operations: [budgetOperation]}, (error, result) => {
					if (error) {
						return res.render('error', { error });
					}
					return res.redirect('/get_campaigns');
				});
			});
		}
	})


});
