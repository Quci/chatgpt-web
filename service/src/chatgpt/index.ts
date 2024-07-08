import 'dotenv/config'
import 'isomorphic-fetch'
import { AzureOpenAI } from 'openai'
import type { OpenAI, AzureClientOptions } from 'openai'
import type { ChatMessage } from 'chatgpt'
import { sendResponse } from '../utils'
import { isNotEmptyString } from '../utils/is'
import type { ApiModel, ModelConfig } from '../types'
import type { RequestOptions } from './types'
import axios from 'axios'

const ErrorCodeMessage: Record<string, string> = {
	401: '[OpenAI] 提供错误的API密钥 | Incorrect API key provided',
	403: '[OpenAI] 服务器拒绝访问，请稍后再试 | Server refused to access, please try again later',
	502: '[OpenAI] 错误的网关 | Bad Gateway',
	503: '[OpenAI] 服务器繁忙，请稍后再试 | Server is busy, please try again later',
	504: '[OpenAI] 网关超时 | Gateway Time-out',
	500: '[OpenAI] 服务器繁忙，请稍后再试 | Internal Server Error',
}

const disableDebug: boolean = process.env.OPENAI_API_DISABLE_DEBUG === 'true'
let apiModel: ApiModel
const model = isNotEmptyString(process.env.OPENAI_API_MODEL) ? process.env.OPENAI_API_MODEL : 'gpt-3.5-turbo'

if (!isNotEmptyString(process.env.AZURE_API_KEY)) {
	throw new Error('Missing AZURE_API_KEY or AZURE_API_KEY environment variable')
}

const azureConfig: AzureClientOptions = {
	endpoint: process.env.AZURE_ENDPOINT,
	apiKey: process.env.AZURE_API_KEY,
	apiVersion: '2024-05-01-preview',
	deployment: 'gpt-4o',
}

console.log('azureConfig', azureConfig)

function convertOpenAIChatCompletionToChatMessage(openAICompletion: OpenAI.ChatCompletion): ChatMessage {
	const firstChoice = openAICompletion.choices[0]
	return {
		id: openAICompletion.id,
		text: firstChoice.message.content,
		role: firstChoice.message.role,
		detail: {
			finish_reason: firstChoice.finish_reason,
			created: openAICompletion.created,
			model: openAICompletion.model,
			index: firstChoice.index,
		},
		parentMessageId: openAICompletion.id,
		conversationId: `${openAICompletion.id}-conv`,
	}
}

function convertRequestOptionsToChatCompletionCreateParams(options: RequestOptions): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
	const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
		options.systemMessage && { role: 'system', content: options.systemMessage },
		{ role: 'user', content: options.message }
	].filter(Boolean)

	if (options.lastContext) {
		messages[messages.length - 1] = { ...messages[messages.length - 1], ...options.lastContext }
	}

	return {
		messages,
		model: 'your_model_id_here', // 替换为实际的模型 ID 或对象
		temperature: options.temperature ?? null,
		top_p: options.top_p ?? null,
	}
}

async function chatReplyProcess(options: RequestOptions) {
	global.console.log('start request')
	const url = process.env.AZ_URL
	const data = convertRequestOptionsToChatCompletionCreateParams(options)

	try {
		const response = await axios.post(url, data, {
			headers: {
				'Api-Key': process.env.AZURE_API_KEY,
				'Content-Type': 'application/json'
			},
		})

		global.console.log('result', response)
		options.process && options.process('done' as unknown as any)
		options.process && options.process(convertOpenAIChatCompletionToChatMessage(response.data))

	} catch (error) {
		console.error("Error calling Azure OpenAI:", error)
	}
}

async function chatConfig() {
	return sendResponse<ModelConfig>({
		type: 'Success',
		data: null,
	})
}

function currentModel(): ApiModel {
	return apiModel
}

export type { ChatMessage }
export { chatReplyProcess, chatConfig, currentModel }
