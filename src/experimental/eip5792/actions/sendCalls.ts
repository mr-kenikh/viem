import type { AbiStateMutability, Address, Narrow } from 'abitype'
import { parseAccount } from '../../../accounts/utils/parseAccount.js'
import type { Client } from '../../../clients/createClient.js'
import type { Transport } from '../../../clients/transports/createTransport.js'
import { AccountNotFoundError } from '../../../errors/account.js'
import type { BaseError } from '../../../errors/base.js'
import { ChainNotFoundError } from '../../../errors/chain.js'
import type { ErrorType } from '../../../errors/utils.js'
import type { Account, GetAccountParameter } from '../../../types/account.js'
import type { Chain, DeriveChain } from '../../../types/chain.js'
import type { ContractFunctionParameters } from '../../../types/contract.js'
import type {
  WalletCapabilities,
  WalletSendCallsParameters,
} from '../../../types/eip1193.js'
import type { Hex } from '../../../types/misc.js'
import type { GetMulticallContractParameters } from '../../../types/multicall.js'
import type { MaybeRequired, OneOf, Prettify } from '../../../types/utils.js'
import { encodeFunctionData } from '../../../utils/abi/encodeFunctionData.js'
import type { RequestErrorType } from '../../../utils/buildRequest.js'
import { numberToHex } from '../../../utils/encoding/toHex.js'
import { getTransactionError } from '../../../utils/errors/getTransactionError.js'

export type SendCallsParameters<
  chain extends Chain | undefined = Chain | undefined,
  account extends Account | undefined = Account | undefined,
  chainOverride extends Chain | undefined = Chain | undefined,
  calls extends readonly unknown[] = readonly unknown[],
  //
  _chain extends Chain | undefined = DeriveChain<chain, chainOverride>,
> = {
  chain?: chainOverride | Chain | undefined
  calls: Calls<Narrow<calls>, _chain>
  capabilities?:
    | WalletSendCallsParameters<WalletCapabilities>[number]['capabilities']
    | undefined
  version?: WalletSendCallsParameters[number]['version'] | undefined
} & GetAccountParameter<account>

export type SendCallsReturnType = string

export type SendCallsErrorType = RequestErrorType | ErrorType

/**
 * Requests the connected wallet to send a batch of calls.
 *
 * - Docs: https://viem.sh/experimental/eip5792/sendCalls
 * - JSON-RPC Methods: [`wallet_sendCalls`](https://eips.ethereum.org/EIPS/eip-5792)
 *
 * @param client - Client to use
 * @returns Transaction identifier. {@link SendCallsReturnType}
 *
 * @example
 * import { createWalletClient, custom } from 'viem'
 * import { mainnet } from 'viem/chains'
 * import { sendCalls } from 'viem/wallet'
 *
 * const client = createWalletClient({
 *   chain: mainnet,
 *   transport: custom(window.ethereum),
 * })
 * const id = await sendCalls(client, {
 *   account: '0xA0Cf798816D4b9b9866b5330EEa46a18382f251e',
 *   calls: [
 *     {
 *       data: '0xdeadbeef',
 *       to: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
 *     },
 *     {
 *       to: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
 *       value: 69420n,
 *     },
 *   ],
 * })
 */
export async function sendCalls<
  const calls extends readonly unknown[],
  chain extends Chain | undefined,
  account extends Account | undefined = undefined,
  chainOverride extends Chain | undefined = undefined,
>(
  client: Client<Transport, chain, account>,
  parameters: SendCallsParameters<chain, account, chainOverride, calls>,
): Promise<SendCallsReturnType> {
  const {
    account: account_ = client.account,
    capabilities,
    chain = client.chain,
    version = '1.0',
  } = parameters

  if (!account_)
    throw new AccountNotFoundError({
      docsPath: '/experimental/eip5792/sendCalls',
    })
  const account = parseAccount(account_)

  const calls = parameters.calls.map((call_: unknown) => {
    const call = call_ as Call

    const chainId = call.chain?.id ?? call.chainId ?? chain?.id
    if (!chainId) throw new ChainNotFoundError()

    const data = call.abi
      ? encodeFunctionData({
          abi: call.abi,
          functionName: call.functionName,
          args: call.args,
        })
      : call.data

    return {
      chainId: numberToHex(chainId),
      data,
      to: call.to,
      value: call.value ? numberToHex(call.value) : undefined,
    }
  })

  try {
    return await client.request(
      {
        method: 'wallet_sendCalls',
        params: [
          {
            calls,
            capabilities,
            chainId: numberToHex(chain!.id),
            from: account.address,
            version,
          },
        ],
      },
      { retryCount: 0 },
    )
  } catch (err) {
    throw getTransactionError(err as BaseError, {
      ...parameters,
      account,
      chain: parameters.chain!,
    })
  }
}

///////////////////////////////////////////////////////////////////////////////////////////////////

type RawCall = { data?: Hex; to?: Address; value?: bigint }

type Call<
  chain extends Chain | undefined = Chain | undefined,
  contractFunctionParameters = Omit<ContractFunctionParameters, 'address'>,
> = OneOf<
  | (contractFunctionParameters & {
      to: Address
      value?: bigint | undefined
    })
  | RawCall
> &
  OneOf<
    | MaybeRequired<
        { chain?: Chain | undefined },
        chain extends Chain ? false : true
      >
    | MaybeRequired<{ chainId?: number }, chain extends Chain ? false : true>
  >

type Calls<
  calls extends readonly unknown[],
  chain extends Chain | undefined,
  ///
  result extends readonly any[] = [],
> = calls extends readonly [] // no calls, return empty
  ? readonly []
  : calls extends readonly [infer call] // one call left before returning `result`
    ? readonly [
        ...result,
        Prettify<
          Call<
            chain,
            Omit<
              GetMulticallContractParameters<call, AbiStateMutability>,
              'address'
            >
          >
        >,
      ]
    : calls extends readonly [infer call, ...infer rest] // grab first call and recurse through `rest`
      ? Calls<
          [...rest],
          chain,
          [
            ...result,
            Prettify<
              Call<
                chain,
                Omit<
                  GetMulticallContractParameters<call, AbiStateMutability>,
                  'address'
                >
              >
            >,
          ]
        >
      : readonly unknown[] extends calls
        ? calls
        : // If `calls` is *some* array but we couldn't assign `unknown[]` to it, then it must hold some known/homogenous type!
          // use this to infer the param types in the case of Array.map() argument
          calls extends readonly (infer call extends Call<
              chain,
              Omit<ContractFunctionParameters, 'address'>
            >)[]
          ? readonly Prettify<call>[]
          : // Fallback
            readonly Call<chain, Omit<ContractFunctionParameters, 'address'>>[]