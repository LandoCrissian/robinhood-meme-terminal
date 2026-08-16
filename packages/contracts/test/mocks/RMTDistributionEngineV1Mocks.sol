// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract DistributionERC20Mock {
    enum Behavior {
        STANDARD,
        FALSE_RETURN,
        REVERTING,
        FEE_ON_TRANSFER,
        OVER_DEBIT
    }

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    Behavior public behavior;
    address public failingRecipient;
    address public reentryTarget;
    bytes public reentryData;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function setBehavior(Behavior value) external {
        behavior = value;
    }

    function setFailingRecipient(address value) external {
        failingRecipient = value;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, recipient, amount);
    }

    function transferFrom(address owner, address recipient, uint256 amount) external returns (bool) {
        uint256 approved = allowance[owner][msg.sender];
        require(approved >= amount, "allowance");
        allowance[owner][msg.sender] = approved - amount;
        _attemptReentry();
        return _transfer(owner, recipient, amount);
    }

    function _transfer(address owner, address recipient, uint256 amount) private returns (bool) {
        if (behavior == Behavior.FALSE_RETURN) return false;
        if (behavior == Behavior.REVERTING || recipient == failingRecipient) revert("token revert");
        uint256 debit = behavior == Behavior.OVER_DEBIT ? amount + 1 : amount;
        uint256 credit = behavior == Behavior.FEE_ON_TRANSFER && amount != 0 ? amount - 1 : amount;
        require(balanceOf[owner] >= debit, "balance");
        balanceOf[owner] -= debit;
        balanceOf[recipient] += credit;
        return true;
    }

    function _attemptReentry() private {
        if (reentryTarget == address(0)) return;
        address target = reentryTarget;
        bytes memory data = reentryData;
        reentryTarget = address(0);
        (bool success,) = target.call(data);
        require(!success, "reentry succeeded");
    }
}

contract DistributionNoReturnERC20Mock {
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address recipient, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
    }

    function transferFrom(address owner, address recipient, uint256 amount) external {
        uint256 approved = allowance[owner][msg.sender];
        require(approved >= amount, "allowance");
        allowance[owner][msg.sender] = approved - amount;
        require(balanceOf[owner] >= amount, "balance");
        balanceOf[owner] -= amount;
        balanceOf[recipient] += amount;
    }
}

contract DistributionERC721Mock {
    mapping(uint256 tokenId => address owner) private _owners;
    mapping(uint256 tokenId => address approved) public getApproved;
    mapping(address owner => mapping(address operator => bool approved)) public isApprovedForAll;

    bool public skipTransfer;
    address public reentryTarget;
    bytes public reentryData;

    function mint(address recipient, uint256 tokenId) external {
        require(_owners[tokenId] == address(0), "minted");
        _owners[tokenId] = recipient;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "missing");
        return owner;
    }

    function approve(address operator, uint256 tokenId) external {
        require(_owners[tokenId] == msg.sender, "owner");
        getApproved[tokenId] = operator;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function setSkipTransfer(bool value) external {
        skipTransfer = value;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        _safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external {
        _safeTransferFrom(from, to, tokenId, data);
    }

    function _safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) private {
        require(_owners[tokenId] == from, "owner");
        require(
            msg.sender == from || getApproved[tokenId] == msg.sender || isApprovedForAll[from][msg.sender], "approval"
        );
        _attemptReentry();
        if (!skipTransfer) {
            _owners[tokenId] = to;
            delete getApproved[tokenId];
        }
        if (to.code.length != 0) {
            bytes4 result = IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data);
            require(result == IERC721Receiver.onERC721Received.selector, "receiver");
        }
    }

    function _attemptReentry() private {
        if (reentryTarget == address(0)) return;
        address target = reentryTarget;
        bytes memory data = reentryData;
        reentryTarget = address(0);
        (bool success,) = target.call(data);
        require(!success, "reentry succeeded");
    }
}

contract DistributionERC1155Mock {
    mapping(uint256 tokenId => mapping(address account => uint256 amount)) private _balances;
    mapping(address owner => mapping(address operator => bool approved)) public isApprovedForAll;

    bool public underCredit;
    bool public overDebit;
    address public reentryTarget;
    bytes public reentryData;

    function mint(address recipient, uint256 tokenId, uint256 amount) external {
        _balances[tokenId][recipient] += amount;
    }

    function balanceOf(address account, uint256 tokenId) external view returns (uint256) {
        return _balances[tokenId][account];
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function setAbnormalBehavior(bool underCredit_, bool overDebit_) external {
        underCredit = underCredit_;
        overDebit = overDebit_;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, uint256 amount, bytes calldata data) external {
        require(msg.sender == from || isApprovedForAll[from][msg.sender], "approval");
        _attemptReentry();
        uint256 debit = overDebit ? amount + 1 : amount;
        uint256 credit = underCredit && amount != 0 ? amount - 1 : amount;
        require(_balances[tokenId][from] >= debit, "balance");
        _balances[tokenId][from] -= debit;
        _balances[tokenId][to] += credit;
        if (to.code.length != 0) {
            bytes4 result = IERC1155Receiver(to).onERC1155Received(msg.sender, from, tokenId, amount, data);
            require(result == IERC1155Receiver.onERC1155Received.selector, "receiver");
        }
    }

    function _attemptReentry() private {
        if (reentryTarget == address(0)) return;
        address target = reentryTarget;
        bytes memory data = reentryData;
        reentryTarget = address(0);
        (bool success,) = target.call(data);
        require(!success, "reentry succeeded");
    }
}

contract DistributionAcceptingReceiver is IERC721Receiver, IERC1155Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}

contract DistributionRejectingReceiver is IERC721Receiver, IERC1155Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert("reject ERC721");
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert("reject ERC1155");
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert("reject ERC1155 batch");
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
