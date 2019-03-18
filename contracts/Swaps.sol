pragma solidity ^0.5.6;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

// todo: checkable
contract Swaps is Ownable {
    using SafeMath for uint;

    bool public isSwapped;
    bool public isCancelled;

    address public baseAddress;
    address public quoteAddress;

    uint public expirationTimestamp;

    mapping(address => uint) private limits;
    mapping(address => uint) private raised;
    mapping(address => address[]) private investors;
    mapping(address => mapping(address => uint)) private investments;

    event Cancel();
    event Deposit(address indexed token, address indexed user, uint amount, uint balance);
    event Refund(address indexed token, address indexed user, uint amount, uint balance);

    constructor(
        address _owner,
        address _baseAddress,
        uint _baseLimit,
        address _quoteAddress,
        uint _quoteLimit,
        uint _expirationTimestamp
    ) public {
        require(_baseAddress != _quoteAddress, "Exchanged tokens must be different");
        require(_baseLimit > 0, "Base limit must be positive");
        require(_quoteLimit > 0, "Quote limit must be positive");
        require(_expirationTimestamp > now, "Expiration time must be in future");

        baseAddress = _baseAddress;
        quoteAddress = _quoteAddress;
        limits[baseAddress] = _baseLimit;
        limits[quoteAddress] = _quoteLimit;

        expirationTimestamp = _expirationTimestamp;
        _transferOwnership(_owner);
    }

    function () external payable {
        this.deposit();
    }

    modifier onlyInvestor() {
        require(_isInvestor(msg.sender), "Allowed only for investors");
        _;
    }

    function deposit() external payable {
        _deposit(address(0), msg.sender, msg.value);
    }

    // todo: check reentrancy
    function depositTokens(address _token) public {
        address from = msg.sender;
        uint allowance = IERC20(_token).allowance(from, address(this));
        IERC20(_token).transferFrom(from, address(this), allowance);
        _deposit(_token, from, allowance);
    }

    function swap() public {
        // todo
    }

    function cancel() public onlyOwner {
        // todo
    }

    // todo: check reentrancy
    function refund() public onlyInvestor {
        // todo
    }

    // todo: withdraw accidentally sent tokens

    function _deposit(address _token, address _from, uint _amount) internal {
        require(baseAddress == _token || quoteAddress == _token, "You can deposit only base or quote currency");
        require(_amount > 0, "Currency amount must be positive");

        if (!_isInvestor(_from)) {
            investors[_token].push(_from);
        }

        investments[_token][_from] = investments[_token][_from].add(_amount);

        raised[_token] = raised[_token].add(_amount);
        require(raised[_token] <= limits[_token], "Raised should not be more than limit");

        // todo: execute swap by last transaction
    }

    function _isInvestor(address _who) internal view returns (bool) {
        if (investments[baseAddress][_who] > 0) {
            return true;
        }

        if (investments[quoteAddress][_who] > 0) {
            return true;
        }

        return false;
    }
}
