const TronWeb = require('tronweb');
import {keccak256} from 'js-sha3';
const BigNumber = require('bignumber.js');
import TronLibrary from './TronLibrary.js';
const axios = require('axios');

export default class TronExplorer {
  constructor(network)
  {
    this.network = network;
    switch(this.network)
    {
      case 'shasta':
        this.node = 'https://api.shasta.trongrid.io/';
        this.tronScanNode = 'https://api.shasta.tronscan.org/';
        break;
      case 'mainnet':
        this.node = 'https://api.trongrid.io/';
        this.tronScanNode = 'https://api.tronscan.org/';
        break;
      default:
        throw new Error('Missing network');
    }
    this.tronLibrary = new TronLibrary();
    this.tronWeb = new TronWeb(this.node, this.node, this.node,
      "da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d9"
    )
  }

  getTx = async function(tx) 
  {
    if(!tx || tx.length != 64) return undefined;
    
    let transactionInfo = await this.tronWeb.trx.getTransaction(tx);
    console.log(`getTx(${tx}): `);
    console.log(transactionInfo);
    return transactionInfo;
  }

  getTxInfo = async function(tx) 
  {
    if(!tx || tx.length != 64) return undefined;
    
    let transactionInfo = await this.tronWeb.trx.getTransactionInfo(tx);
    console.log(`getTxInfo(${tx}): `);
    console.log(transactionInfo);
    return transactionInfo;
  }
  
  getAbi = async function(address)
  {
    if(!address) return undefined;
    const abi = await this.tronWeb.trx.getContract(this.tronLibrary.toBase58(address));
    console.log(`getAbi(${address}): `);
    console.log(abi);
    return abi;
  }

  getAccount = async function(address)
  {
    const account = await this.tronWeb.trx.getAccount(address);
    console.log(`getAccount(${address}): `);
    console.log(account);
    return account;
  }

  getUnconfirmedAccount = async function(address)
  {
    const account = await this.tronWeb.trx.getUnconfirmedAccount(address);
    console.log(`getUnconfirmedAccount(${address}): `);
    console.log(account);
    return account;
  }

  getRecentTransactions = async function()
  {
    const transactions = await axios.get(`${this.tronScanNode}api/transaction?sort=-timestamp&count=false&limit=200&start=0`);
    console.log(`getRecentTransactions()`);
    console.log(transactions);
    return transactions;
  }

  getRecentEvents = async function(address, eventName, count)
  {
    if(eventName)
    {
      eventName = `/${eventName}`;
    }
    else
    {
      eventName = '';
    }
    if(!count)
    {
      count = 200;
    }
    const events = await axios.get(`${this.node}event/contract/${address}${eventName}?size=${count}`)
    console.log(`getRecentEvents(${address}, ${eventName}): `);
    console.log(events);
    return events.data;
  }

  parseLog = async function(log)
  {
    const abi = (await this.getAbi(log.address)).abi.entrys;
    for(let i = 0; i < abi.length; i++)
    {
      let event = abi[i];
      if(event.type != 'Event') continue;

      let signature = `${event.name}(`;
      if(event.inputs)
      {
        event.inputs.forEach((input, index) => 
        {
          if(index > 0)
          {
            signature += ',';
          }

          signature += input.type;
        });
      }
      signature += ')';
      const hash = keccak256(this.tronWeb.utils.code.stringToBytes(signature))
      // console.log(`${signature}: ${hash.toString()}`);
      if(hash.toString() == log.topics[0].toString()) 
      {
        let call = `${event.name}(`;
        let indexedId = 1;
        let data = log.data;
        let params = [];
        event.inputs.forEach((input, index) => 
        {
          if(index > 0)
          {
            call += ',';
          }
          let value;
          if(input.indexed)
          {
            value = log.topics[indexedId++];
          }
          else
          {
            value = data.substring(0, 64);
            data = data.substring(64);
          }
          call += value;
          params.push({name: input.name, type: input.type, value});
        });
        if(data.length > 0) throw new Error(data);
        call += ')';

        return {
          address: '41' + log.address,
          signature,
          call,
          event: event.name,
          params
        }
      }
    }
  }

  parseCall = async function(contractAddress, callData)
  {
    let call = {};
    const abi = (await this.getAbi(contractAddress)).abi.entrys;
    let entry;
    for(let i = 0; i < abi.length; i++)
    {
      entry = abi[i];
      if(entry.type != 'Function') continue;

      let signature = `${entry.name}(`;
      if(entry.inputs)
      {
        entry.inputs.forEach((input, index) => 
        {
          if(index > 0)
          {
            signature += ',';
          }

          signature += input.type;
        });
      }
      signature += ')';
      const hash = keccak256(this.tronWeb.utils.code.stringToBytes(signature)).substring(0, 8);
      // console.log(`${signature}: ${hash.toString()}`);
      if(callData.startsWith(hash))
      {
        call.signature = signature;
        call.function = entry.name;
        call.params = [];
        break;
      }
    }

    if(entry.inputs)
    {
      let pos = 8;
      let arrayCount = 0;
      for(let i = 0; i < entry.inputs.length; i++)
      {
        if(entry.inputs[i].type.endsWith('[]'))
        {
          arrayCount++;
        }
      }
      pos += 64 * arrayCount;
      entry.inputs.forEach((input) => 
      {
        let param = {
          name: input.name,
          type: input.type
        };

        if(input.type.endsWith('[]'))
        {
          const arrayLength = new BigNumber(callData.substr(pos, 64), 16).toNumber();
          pos += 64;
          param.value = [];
          for(let i = 0; i < arrayLength; i++)
          {
            param.value.push(callData.substr(pos, 64));
            pos += 64;
          }
        }
        else
        {
          //if(pos + 64 > callData.length) throw new Error("parsing error");
          param.value = callData.substr(pos, 64);
          pos += 64;
        }

        call.params.push(param);
      });
    }

    return call;
  }
} 
